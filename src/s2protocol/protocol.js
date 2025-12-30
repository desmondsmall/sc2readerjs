// @ts-check

/**
 * Data-driven decoder using Blizzard's published protocol schemas.
 *
 * `src/data/protocols/protocol{build}.json` contains type declarations for a specific SC2 build.
 * This module loads those declarations and can decode:
 * - `NNet.Replay.SHeader` from the replay header blob
 * - `NNet.Game.SDetails` from `replay.details`
 *
 * The decoding strategy is intentionally minimal: we implement only the type kinds needed
 * for header/details (Bool/Int/Enum/String/Blob/Array/Optional/Struct/UserType).
 */

const fs = require("fs/promises");
const path = require("path");
const { VersionedDecoder } = require("./versionedDecoder");
const { BitPackedBuffer } = require("./bitPacked");

function intFromNode(node) {
  if (!node) return null;
  if (node.type === "IntLiteral") return BigInt(node.value);
  return null;
}

function parseIntLiteral(node) {
  if (!node) return null;
  if (node.type === "IntLiteral") return Number(node.value);
  if (typeof node.value === "string") return Number(node.value);
  return null;
}

class Protocol {
  constructor(build, declsByFullname, constsByFullname, constDeclsByFullname) {
    this.build = build;
    this.declsByFullname = declsByFullname;
    this.constsByFullname = constsByFullname;
    this.constDeclsByFullname = constDeclsByFullname;
    this.enums = new Map(); // fullname -> Map<number,string>
    this.enumMembersToValue = new Map(); // enum member fullname -> number
    this.gameEventTypeById = new Map(); // number -> event struct fullname
    this.trackerEventTypeById = new Map(); // number -> event struct fullname
    this.messageEventTypeById = new Map(); // number -> event struct fullname
    this.#indexEnums();
    this.#indexGameEventTypes();
    this.#indexMessageEventTypes();
    this.#indexTrackerEventTypes();
  }

  static async fromJsonFile(jsonPath) {
    const content = await fs.readFile(jsonPath, "utf8");
    const json = JSON.parse(content);
    const buildMatch = path.basename(jsonPath).match(/protocol(\d+)\.json$/);
    const build = buildMatch ? Number(buildMatch[1]) : null;

    const declsByFullname = new Map();
    const constDecls = new Map(); // fullname -> decl
    const visitModule = (mod) => {
      for (const decl of mod.decls ?? []) {
        if (decl.type === "TypeDecl") {
          declsByFullname.set(decl.fullname, decl);
        } else if (decl.type === "ConstDecl") {
          constDecls.set(decl.fullname, decl);
        } else if (decl.type === "Module") {
          visitModule(decl);
        }
      }
    };
    for (const mod of json.modules ?? []) visitModule(mod);

    const constsByFullname = new Map();
    const evalCache = new Map();
    const evalIntExpr = (node) =>
      Protocol.#evalIntExprStatic(node, constDecls, evalCache);

    for (const [fullname, decl] of constDecls.entries()) {
      const v = evalIntExpr(decl.value);
      if (v !== null) constsByFullname.set(fullname, v);
    }

    return new Protocol(build, declsByFullname, constsByFullname, constDecls);
  }

  static #evalIntExprStatic(node, constDecls, evalCache) {
    if (!node) return null;
    const lit = intFromNode(node);
    if (lit !== null) return lit;

    if (node.type === "IdentifierExpr") {
      const fullname = node.fullname;
      if (evalCache.has(fullname)) return evalCache.get(fullname);
      const decl = constDecls.get(fullname);
      if (!decl) return null;
      evalCache.set(fullname, null);
      const value = Protocol.#evalIntExprStatic(decl.value, constDecls, evalCache);
      evalCache.set(fullname, value);
      return value;
    }

    const lhs = Protocol.#evalIntExprStatic(node.lhs, constDecls, evalCache);
    const rhs = Protocol.#evalIntExprStatic(node.rhs, constDecls, evalCache);
    if (lhs === null || rhs === null) return null;

    if (node.type === "PowExpr") return lhs ** rhs;
    if (node.type === "LShiftExpr") return lhs << rhs;
    if (node.type === "RShiftExpr") return lhs >> rhs;
    if (node.type === "PlusExpr") return lhs + rhs;
    if (node.type === "MinusExpr") return lhs - rhs;
    if (node.type === "MulExpr") return lhs * rhs;
    if (node.type === "DivExpr") return rhs === 0n ? null : lhs / rhs;

    return null;
  }

  enumValueToName(enumFullname, value) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    const map = this.enums.get(enumFullname);
    if (!map) return num;
    return map.get(num) ?? num;
  }

  decodeReplayHeader(contents) {
    const decoder = new VersionedDecoder(contents);
    return this.decodeUserType(decoder, "NNet.Replay.SHeader");
  }

  decodeReplayDetails(contents) {
    const decoder = new VersionedDecoder(contents);
    return this.decodeUserType(decoder, "NNet.Game.SDetails");
  }

  decodeReplayInitData(contents) {
    const buffer = new BitPackedBuffer(contents, "big");
    return this.#decodeBitPackedUserType(buffer, "NNet.Replay.SInitData");
  }

  decodeStructFields(decoder, fullname, fieldNames) {
    const decl = this.declsByFullname.get(fullname);
    if (!decl) throw new Error(`Unknown type: ${fullname}`);
    if (decl.type_info?.type !== "StructType") {
      throw new Error(`Type ${fullname} is not a StructType`);
    }
    const wanted = new Set(fieldNames ?? []);

    const fieldsByTag = new Map();
    for (const field of decl.type_info.fields ?? []) {
      if (field.type !== "MemberStructField") continue;
      if (!wanted.has(field.name)) continue;
      const tag = parseIntLiteral(field.tag);
      if (tag === null || tag === undefined) continue;
      fieldsByTag.set(tag, {
        name: field.name,
        decode: () => this.decodeTypeInfo(decoder, field.type_info),
      });
    }

    return decoder.readStruct(fieldsByTag);
  }

  getEnumBits(enumFullname) {
    const decl = this.declsByFullname.get(enumFullname);
    const bounds = decl?.type_info?.bounds;
    if (!bounds || bounds.type !== "MinMaxConstraint") return null;

    const min = this.#evalConstraintValue(bounds.min);
    const max = this.#evalConstraintValue(bounds.max);
    if (min === null || max === null) return null;
    const maxInclusive = bounds.max?.inclusive !== false;
    const maxInclusiveValue = maxInclusive ? max : max - 1n;
    const range = maxInclusiveValue - min + 1n;
    if (range <= 1n) return 0;
    let bits = 0;
    let v = range - 1n;
    while (v > 0n) {
      v >>= 1n;
      bits += 1;
    }
    return bits;
  }

  /**
   * Iterates game events from `replay.game.events`.
   * Yields objects: { userId, gameloop, eventId, eventType, payload }
   *
   * This only decodes enough to advance the stream; event payloads are decoded and discarded.
   */
  *iterateGameEvents(contents, options = {}) {
    const buffer = new BitPackedBuffer(contents, "big");
    const eventIdBits = this.getEnumBits("NNet.Game.EEventId");
    if (eventIdBits === null) throw new Error("Unable to compute EEventId bit width");

    const decodeMode = options.decode ?? "none";
    const eventTypes =
      options.eventTypes instanceof Set
        ? options.eventTypes
        : options.eventTypes
          ? new Set(options.eventTypes)
          : null;

    let gameloop = 0;
    while (!buffer.done()) {
      const delta = this.#readSVarUint32BitPacked(buffer);
      gameloop += delta;

      // `NNet.Replay.SGameUserId` in game events is effectively a 5-bit uint (0..16).
      const userId = buffer.readBits(5);

      const eventId = buffer.readBits(eventIdBits);
      const eventType = this.gameEventTypeById.get(eventId);
      if (!eventType) {
        throw new Error(`Unknown game event id ${eventId} for build ${this.build}`);
      }

      let payload = null;
      const wantDecode = decodeMode === "full" && (!eventTypes || eventTypes.has(eventType));
      if (wantDecode) payload = this.#decodeBitPackedUserType(buffer, eventType);
      else this.#skipBitPackedUserType(buffer, eventType);
      buffer.byteAlign();

      yield { userId, gameloop, eventId, eventType, payload };
    }
  }

  /**
   * Iterates message events from `replay.message.events`.
   * Yields objects: { userId, gameloop, eventId, eventType, payload }
   *
   * @param {Buffer} contents
   * @param {object} [options]
   * @param {"none"|"full"} [options.decode]
   * @param {string[]|Set<string>|null} [options.eventTypes] Event type fullnames to decode (others are skipped)
   */
  *iterateMessageEvents(contents, options = {}) {
    const buffer = new BitPackedBuffer(contents, "big");
    const eventIdBits = this.getEnumBits("NNet.Game.EMessageId");
    if (eventIdBits === null) throw new Error("Unable to compute EMessageId bit width");

    const decodeMode = options.decode ?? "none";
    const eventTypes =
      options.eventTypes instanceof Set
        ? options.eventTypes
        : options.eventTypes
          ? new Set(options.eventTypes)
          : null;

    let gameloop = 0;
    while (!buffer.done()) {
      const delta = this.#readSVarUint32BitPacked(buffer);
      gameloop += delta;

      const userId = buffer.readBits(5);

      const eventId = buffer.readBits(eventIdBits);
      const eventType = this.messageEventTypeById.get(eventId);
      if (!eventType) {
        throw new Error(`Unknown message event id ${eventId} for build ${this.build}`);
      }

      let payload = null;
      const wantDecode = decodeMode === "full" && (!eventTypes || eventTypes.has(eventType));
      if (wantDecode) payload = this.#decodeBitPackedUserType(buffer, eventType);
      else this.#skipBitPackedUserType(buffer, eventType);
      buffer.byteAlign();

      yield { userId, gameloop, eventId, eventType, payload };
    }
  }

  /**
   * Iterates tracker events from `replay.tracker.events`.
   * Yields objects: { gameloop, eventId, eventType, payload }
   *
   * By default this skips event payloads (payload=null). Use options to selectively decode.
   *
   * @param {Buffer} contents
   * @param {object} [options]
   * @param {"none"|"full"|"fields"} [options.decode]
   * @param {string[]|Set<string>|null} [options.eventTypes] Event type fullnames to decode (others are skipped)
   * @param {Record<string,string[]>} [options.fieldsByEventType] eventType fullname -> field names
   */
  *iterateTrackerEvents(contents, options = {}) {
    const decoder = new VersionedDecoder(contents);
    const decodeMode = options.decode ?? "none";
    const eventTypes =
      options.eventTypes instanceof Set
        ? options.eventTypes
        : options.eventTypes
          ? new Set(options.eventTypes)
          : null;
    const fieldsByEventType = options.fieldsByEventType ?? null;

    let gameloop = 0;
    while (!decoder.done()) {
      const deltaChoice = this.decodeUserType(decoder, "NNet.SVarUint32");
      const delta = Protocol.#svarUint32Value(deltaChoice);
      gameloop += delta;

      const eventIdRaw = this.decodeUserType(decoder, "NNet.Replay.Tracker.EEventId");
      const eventId = Number(eventIdRaw);
      const eventType = this.trackerEventTypeById.get(eventId);
      if (!eventType) {
        throw new Error(`Unknown tracker event id ${eventId} for build ${this.build}`);
      }

      let payload = null;
      const wantDecode = decodeMode !== "none" && (!eventTypes || eventTypes.has(eventType));
      if (!wantDecode) {
        decoder.skipInstance();
      } else if (decodeMode === "full") {
        payload = this.decodeUserType(decoder, eventType);
      } else if (decodeMode === "fields") {
        const fieldNames = fieldsByEventType?.[eventType];
        if (!fieldNames) decoder.skipInstance();
        else payload = this.decodeStructFields(decoder, eventType, fieldNames);
      } else {
        decoder.skipInstance();
      }

      decoder.byteAlign();
      yield { gameloop, eventId, eventType, payload };
    }
  }

  decodeUserType(decoder, fullname) {
    const decl = this.declsByFullname.get(fullname);
    if (!decl) throw new Error(`Unknown type: ${fullname}`);
    return this.decodeTypeInfo(decoder, decl.type_info);
  }

  decodeTypeInfo(decoder, typeInfo) {
    switch (typeInfo.type) {
      case "UserType":
        return this.decodeUserType(decoder, typeInfo.fullname);
      case "BoolType":
        return decoder.readBool();
      case "FourCCType":
        return decoder.readFourCC();
      case "BlobType":
        return decoder.readBlob();
      case "StringType":
        return decoder.readBlob();
      case "IntType": {
        const maxEvalue = typeInfo.bounds?.max?.evalue ?? null;
        const maxBound =
          typeof maxEvalue === "string" && maxEvalue.length > 0
            ? (() => {
                try {
                  return BigInt(maxEvalue);
                } catch {
                  return null;
                }
              })()
            : null;

        // Versioned VInt decoding needs BigInt for types that can exceed 32-bit (e.g. NNet.int64).
        if (maxBound !== null && maxBound > 2147483648n) {
          const v = decoder.readIntBigInt();
          const abs = v < 0n ? -v : v;
          if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
          return v;
        }
        return decoder.readInt();
      }
      case "EnumType":
        // Enums in the versioned format are encoded as VInts and should comfortably fit in Number.
        return decoder.readInt();
      case "ChoiceType": {
        const fieldsByTag = new Map();
        for (const field of typeInfo.fields ?? []) {
          if (field.type !== "MemberChoiceField") continue;
          const tag = parseIntLiteral(field.tag);
          if (tag === null || tag === undefined) continue;
          fieldsByTag.set(tag, {
            name: field.name,
            decode: () => this.decodeTypeInfo(decoder, field.type_info),
          });
        }
        return decoder.readChoice(fieldsByTag);
      }
      case "ArrayType": {
        return decoder.readArray(() =>
          this.decodeTypeInfo(decoder, typeInfo.element_type)
        );
      }
      case "OptionalType": {
        return decoder.readOptional(() =>
          this.decodeTypeInfo(decoder, typeInfo.type_info)
        );
      }
      case "StructType": {
        const fieldsByTag = new Map();
        for (const field of typeInfo.fields ?? []) {
          if (field.type !== "MemberStructField") continue;
          const tag = parseIntLiteral(field.tag);
          if (tag === null || tag === undefined) continue;
          fieldsByTag.set(tag, {
            name: field.name,
            decode: () => this.decodeTypeInfo(decoder, field.type_info),
          });
        }
        return decoder.readStruct(fieldsByTag);
      }
      default:
        throw new Error(`Unsupported type_info.type: ${typeInfo.type}`);
    }
  }

  #decodeBitPackedUserType(buffer, fullname) {
    const decl = this.declsByFullname.get(fullname);
    if (!decl) throw new Error(`Unknown type: ${fullname}`);
    return this.#decodeBitPackedTypeInfo(buffer, decl.type_info);
  }

  #skipBitPackedUserType(buffer, fullname) {
    const decl = this.declsByFullname.get(fullname);
    if (!decl) throw new Error(`Unknown type: ${fullname}`);
    this.#skipBitPackedTypeInfo(buffer, decl.type_info);
  }

  #decodeBitPackedTypeInfo(buffer, typeInfo) {
    switch (typeInfo.type) {
      case "UserType":
        return this.#decodeBitPackedUserType(buffer, typeInfo.fullname);
      case "BoolType":
        return buffer.readBits(1) !== 0;
      case "FourCCType":
        return buffer.readUnalignedBytes(4);
      case "BlobType":
        return this.#readBitPackedBlob(buffer, typeInfo.bounds);
      case "StringType":
      case "AsciiStringType":
        return this.#readBitPackedBlob(buffer, typeInfo.bounds);
      case "InumType": {
        const bits = this.#inumTypeToBits(typeInfo);
        if (bits <= 32) return buffer.readBits(bits);
        return buffer.readBitsBigInt(bits);
      }
      case "IntType":
      case "EnumType": {
        const { min, bits } =
          typeInfo.type === "EnumType" && !typeInfo.bounds
            ? this.#enumTypeToMinBits(typeInfo)
            : this.#constraintToMinBits(typeInfo.bounds);
        if (bits <= 32) return Number(min) + buffer.readBits(bits);
        const v = buffer.readBitsBigInt(bits);
        return min + v;
      }
      case "BitArrayType": {
        const { min, bits } = this.#constraintToMinBits(typeInfo.bounds);
        const length = Number(min) + buffer.readBits(bits);
        return { length, data: buffer.readBitsBigInt(length) };
      }
      case "ArrayType":
      case "DynArrayType": {
        const { min, bits } = this.#constraintToMinBits(typeInfo.bounds);
        const length = Number(min) + buffer.readBits(bits);
        const out = new Array(length);
        for (let i = 0; i < length; i++) {
          out[i] = this.#decodeBitPackedTypeInfo(buffer, typeInfo.element_type);
        }
        return out;
      }
      case "OptionalType": {
        const exists = buffer.readBits(1) !== 0;
        return exists ? this.#decodeBitPackedTypeInfo(buffer, typeInfo.type_info) : null;
      }
      case "ChoiceType": {
        const fields = typeInfo.fields ?? [];
        const tags = fields.map((f) => Number(f.tag?.value ?? 0));
        const minTag = Math.min(...tags);
        const maxTag = Math.max(...tags);
        const range = maxTag - minTag + 1;
        const tagBits = range <= 1 ? 0 : Math.ceil(Math.log2(range));
        const tag = minTag + (tagBits ? buffer.readBits(tagBits) : 0);
        const field = fields.find((f) => Number(f.tag?.value ?? 0) === tag);
        if (!field) return {};
        return { [field.name]: this.#decodeBitPackedTypeInfo(buffer, field.type_info) };
      }
      case "StructType": {
        const result = {};

        for (const parent of typeInfo.parents ?? []) {
          const decoded = this.#decodeBitPackedTypeInfo(buffer, parent);
          if (decoded && typeof decoded === "object" && !Buffer.isBuffer(decoded)) {
            Object.assign(result, decoded);
          }
        }

        for (const field of typeInfo.fields ?? []) {
          if (field.type !== "MemberStructField") continue;
          result[field.name] = this.#decodeBitPackedTypeInfo(buffer, field.type_info);
        }

        return result;
      }
      case "NullType":
        return null;
      default:
        throw new Error(`Unsupported bit-packed type_info.type: ${typeInfo.type}`);
    }
  }

  #skipBitPackedTypeInfo(buffer, typeInfo) {
    switch (typeInfo.type) {
      case "UserType":
        return this.#skipBitPackedUserType(buffer, typeInfo.fullname);
      case "BoolType":
        buffer.readBits(1);
        return;
      case "FourCCType":
        buffer.readBits(8);
        buffer.readBits(8);
        buffer.readBits(8);
        buffer.readBits(8);
        return;
      case "BlobType":
      case "StringType":
      case "AsciiStringType": {
        const { min, bits } = this.#constraintToMinBits(typeInfo.bounds);
        const length = Number(min) + buffer.readBits(bits);
        buffer.readAlignedBytes(length);
        return;
      }
      case "InumType": {
        const bits = this.#inumTypeToBits(typeInfo);
        if (bits <= 32) buffer.readBits(bits);
        else buffer.readBitsBigInt(bits);
        return;
      }
      case "IntType":
      case "EnumType": {
        const { bits } =
          typeInfo.type === "EnumType" && !typeInfo.bounds
            ? this.#enumTypeToMinBits(typeInfo)
            : this.#constraintToMinBits(typeInfo.bounds);
        if (bits <= 32) buffer.readBits(bits);
        else buffer.readBitsBigInt(bits);
        return;
      }
      case "BitArrayType": {
        const { min, bits } = this.#constraintToMinBits(typeInfo.bounds);
        const length = Number(min) + buffer.readBits(bits);
        if (length <= 32) buffer.readBits(length);
        else buffer.readBitsBigInt(length);
        return;
      }
      case "ArrayType":
      case "DynArrayType": {
        const { min, bits } = this.#constraintToMinBits(typeInfo.bounds);
        const length = Number(min) + buffer.readBits(bits);
        for (let i = 0; i < length; i++) {
          this.#skipBitPackedTypeInfo(buffer, typeInfo.element_type);
        }
        return;
      }
      case "OptionalType": {
        const exists = buffer.readBits(1) !== 0;
        if (exists) this.#skipBitPackedTypeInfo(buffer, typeInfo.type_info);
        return;
      }
      case "ChoiceType": {
        const fields = typeInfo.fields ?? [];
        const tags = fields.map((f) => Number(f.tag?.value ?? 0));
        const minTag = Math.min(...tags);
        const maxTag = Math.max(...tags);
        const range = maxTag - minTag + 1;
        const tagBits = range <= 1 ? 0 : Math.ceil(Math.log2(range));
        const tag = minTag + (tagBits ? buffer.readBits(tagBits) : 0);
        const field = fields.find((f) => Number(f.tag?.value ?? 0) === tag);
        if (field) this.#skipBitPackedTypeInfo(buffer, field.type_info);
        return;
      }
      case "StructType": {
        for (const parent of typeInfo.parents ?? []) {
          this.#skipBitPackedTypeInfo(buffer, parent);
        }
        for (const field of typeInfo.fields ?? []) {
          if (field.type !== "MemberStructField") continue;
          this.#skipBitPackedTypeInfo(buffer, field.type_info);
        }
        return;
      }
      case "NullType":
        return;
      default:
        throw new Error(`Unsupported bit-packed type_info.type: ${typeInfo.type}`);
    }
  }

  #readBitPackedBlob(buffer, bounds) {
    const { min, bits } = this.#constraintToMinBits(bounds);
    const length = Number(min) + buffer.readBits(bits);
    return buffer.readAlignedBytes(length);
  }

  #readSVarUint32BitPacked(buffer) {
    // Optimized decode for `NNet.SVarUint32` in bit-packed event streams.
    const choice = buffer.readBits(2);
    if (choice === 0) return buffer.readBits(6);
    if (choice === 1) return buffer.readBits(14);
    if (choice === 2) return buffer.readBits(22);
    return buffer.readBits(32);
  }

  #evalConstraintValue(nodeWrapper) {
    if (!nodeWrapper) return null;
    const value = nodeWrapper.value;
    if (!value) return null;
    if (value.type === "IntLiteral") return BigInt(value.value);
    if (value.type === "IdentifierExpr") return this.constsByFullname.get(value.fullname) ?? null;
    if (value.type === "PowExpr" || value.type === "LShiftExpr" || value.type === "RShiftExpr" || value.type === "PlusExpr" || value.type === "MinusExpr" || value.type === "MulExpr" || value.type === "DivExpr") {
      // Minimal expression evaluation for common bound forms.
      const lhs = this.#evalExpr(value.lhs);
      const rhs = this.#evalExpr(value.rhs);
      if (lhs === null || rhs === null) return null;
      if (value.type === "PowExpr") return lhs ** rhs;
      if (value.type === "LShiftExpr") return lhs << rhs;
      if (value.type === "RShiftExpr") return lhs >> rhs;
      if (value.type === "PlusExpr") return lhs + rhs;
      if (value.type === "MinusExpr") return lhs - rhs;
      if (value.type === "MulExpr") return lhs * rhs;
      if (value.type === "DivExpr") return rhs === 0n ? null : lhs / rhs;
    }
    return this.#evalExpr(value);
  }

  #evalExpr(node) {
    if (!node) return null;
    if (node.type === "IntLiteral") return BigInt(node.value);
    if (node.type === "NegateExpr") {
      const rhs = this.#evalExpr(node.rhs);
      return rhs === null ? null : -rhs;
    }
    if (node.type === "IdentifierExpr") {
      const fromConst = this.constsByFullname.get(node.fullname);
      if (fromConst !== undefined) return fromConst;

      const fromEnum = this.enumMembersToValue.get(node.fullname);
      if (fromEnum !== undefined) return BigInt(fromEnum);

      const decl = this.constDeclsByFullname.get(node.fullname);
      if (decl?.value) {
        const evaluated = this.#evalExpr(decl.value);
        if (evaluated !== null) this.constsByFullname.set(node.fullname, evaluated);
        return evaluated;
      }
      return null;
    }
    if (node.type === "PowExpr" || node.type === "LShiftExpr" || node.type === "RShiftExpr" || node.type === "PlusExpr" || node.type === "MinusExpr" || node.type === "MulExpr" || node.type === "DivExpr") {
      const lhs = this.#evalExpr(node.lhs);
      const rhs = this.#evalExpr(node.rhs);
      if (lhs === null || rhs === null) return null;
      if (node.type === "PowExpr") return lhs ** rhs;
      if (node.type === "LShiftExpr") return lhs << rhs;
      if (node.type === "RShiftExpr") return lhs >> rhs;
      if (node.type === "PlusExpr") return lhs + rhs;
      if (node.type === "MinusExpr") return lhs - rhs;
      if (node.type === "MulExpr") return lhs * rhs;
      if (node.type === "DivExpr") return rhs === 0n ? null : lhs / rhs;
    }
    return null;
  }

  #constraintToMinBits(bounds) {
    if (!bounds || (bounds.type !== "MinMaxConstraint" && bounds.type !== "ExactConstraint")) {
      throw new Error("Missing MinMaxConstraint bounds for bit-packed decode");
    }
    const min = this.#evalConstraintValue(bounds.min);
    const max = this.#evalConstraintValue(bounds.max);
    if (min === null || max === null) {
      const minDesc = bounds.min?.value?.fullname || bounds.min?.value?.type || "unknown";
      const maxDesc = bounds.max?.value?.fullname || bounds.max?.value?.type || "unknown";
      throw new Error(`Unable to evaluate bounds min/max (min=${minDesc}, max=${maxDesc})`);
    }
    const maxInclusive = bounds.max?.inclusive !== false;
    const maxInclusiveValue = maxInclusive ? max : max - 1n;
    const range = maxInclusiveValue - min + 1n;
    if (range <= 1n) return { min, bits: 0 };
    let bits = 0;
    let v = range - 1n;
    while (v > 0n) {
      v >>= 1n;
      bits += 1;
    }
    return { min, bits };
  }

  #enumTypeToMinBits(enumTypeInfo) {
    // Fallback for enums without explicit bounds: derive a minimal bit width from values.
    let min = 0n;
    let max = 0n;
    for (const f of enumTypeInfo.fields ?? []) {
      const v = f.value?.type === "IntLiteral" ? BigInt(f.value.value) : null;
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min + 1n;
    if (range <= 1n) return { min, bits: 0 };
    let bits = 0;
    let v = range - 1n;
    while (v > 0n) {
      v >>= 1n;
      bits += 1;
    }
    return { min, bits };
  }

  #inumTypeToBits(inumTypeInfo) {
    // Bitmask enums: values are typically `1 << n`, so compute the highest bit used.
    let max = 0n;
    for (const f of inumTypeInfo.fields ?? []) {
      if (f.type !== "MemberInumField") continue;
      const v = this.#evalExpr(f.value);
      if (v === null) continue;
      if (v > max) max = v;
    }
    if (max <= 0n) return 0;
    let bits = 0;
    let v = max;
    while (v > 0n) {
      v >>= 1n;
      bits += 1;
    }
    return bits;
  }

  #indexEnums() {
    for (const [fullname, decl] of this.declsByFullname.entries()) {
      if (decl.type_info?.type !== "EnumType") continue;
      const map = new Map();
      for (const f of decl.type_info.fields ?? []) {
        const val = f.value?.type === "IntLiteral" ? Number(f.value.value) : null;
        if (val === null) continue;
        map.set(val, f.fullname || f.name);
        if (f.fullname) this.enumMembersToValue.set(f.fullname, val);
      }
      this.enums.set(fullname, map);
    }
  }

  #indexGameEventTypes() {
    // Build eventId -> struct fullname mapping by scanning structs with a `EEVENTID` const.
    for (const [fullname, decl] of this.declsByFullname.entries()) {
      if (!fullname.startsWith("NNet.Game.")) continue;
      if (decl.type_info?.type !== "StructType") continue;
      const fields = decl.type_info.fields ?? [];
      const eventIdConst = fields.find(
        (f) => f.type === "ConstDecl" && f.name === "EEVENTID"
      );
      const ref = eventIdConst?.value;
      if (!ref || ref.type !== "IdentifierExpr") continue;

      const eventId = this.enumMembersToValue.get(ref.fullname);
      if (eventId === undefined) continue;

      this.gameEventTypeById.set(eventId, fullname);
    }
  }

  #indexMessageEventTypes() {
    // Build messageId -> struct fullname mapping by scanning structs with a `EMESSAGEID` const.
    for (const [fullname, decl] of this.declsByFullname.entries()) {
      if (!fullname.startsWith("NNet.Game.")) continue;
      if (decl.type_info?.type !== "StructType") continue;
      const fields = decl.type_info.fields ?? [];
      const messageIdConst = fields.find(
        (f) => f.type === "ConstDecl" && f.name === "EMESSAGEID"
      );
      const ref = messageIdConst?.value;
      if (!ref || ref.type !== "IdentifierExpr") continue;

      const messageId = this.enumMembersToValue.get(ref.fullname);
      if (messageId === undefined) continue;

      this.messageEventTypeById.set(messageId, fullname);
    }
  }

  #indexTrackerEventTypes() {
    // Build eventId -> struct fullname mapping by scanning tracker structs with a `EEVENTID` const.
    for (const [fullname, decl] of this.declsByFullname.entries()) {
      if (!fullname.startsWith("NNet.Replay.Tracker.")) continue;
      if (decl.type_info?.type !== "StructType") continue;
      const fields = decl.type_info.fields ?? [];
      const eventIdConst = fields.find(
        (f) => f.type === "ConstDecl" && f.name === "EEVENTID"
      );
      const ref = eventIdConst?.value;
      if (!ref || ref.type !== "IdentifierExpr") continue;

      const eventId = this.enumMembersToValue.get(ref.fullname);
      if (eventId === undefined) continue;

      this.trackerEventTypeById.set(eventId, fullname);
    }
  }

  static #svarUint32Value(choiceObj) {
    if (typeof choiceObj === "number") return choiceObj;
    if (!choiceObj || typeof choiceObj !== "object") return 0;
    for (const v of Object.values(choiceObj)) return Number(v) || 0;
    return 0;
  }
}

module.exports = { Protocol };
