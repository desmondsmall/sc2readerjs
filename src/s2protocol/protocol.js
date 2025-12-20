const fs = require("fs/promises");
const path = require("path");
const { VersionedDecoder } = require("./versionedDecoder");

function parseIntLiteral(node) {
  if (!node) return null;
  if (node.type === "IntLiteral") return Number(node.value);
  if (typeof node.value === "string") return Number(node.value);
  return null;
}

function boundsToBits(min, maxInclusive) {
  const range = maxInclusive - min + 1;
  if (range <= 1) return 0;
  return Math.ceil(Math.log2(range));
}

function constraintToMinMax(constraint) {
  if (!constraint) return null;
  if (constraint.type !== "MinMaxConstraint") return null;
  const min = parseIntLiteral(constraint.min?.value);
  let max = parseIntLiteral(constraint.max?.value);
  const maxInclusive = constraint.max?.inclusive !== false;
  if (!maxInclusive) max -= 1;
  return { min, max };
}

class Protocol {
  constructor(build, declsByFullname) {
    this.build = build;
    this.declsByFullname = declsByFullname;
    this.enums = new Map(); // fullname -> Map<number,string>
    this.#indexEnums();
  }

  static async fromJsonFile(jsonPath) {
    const content = await fs.readFile(jsonPath, "utf8");
    const json = JSON.parse(content);
    const buildMatch = path.basename(jsonPath).match(/protocol(\d+)\.json$/);
    const build = buildMatch ? Number(buildMatch[1]) : null;

    const declsByFullname = new Map();
    const visitModule = (mod) => {
      for (const decl of mod.decls ?? []) {
        if (decl.type === "TypeDecl") {
          declsByFullname.set(decl.fullname, decl);
        } else if (decl.type === "Module") {
          visitModule(decl);
        }
      }
    };
    for (const mod of json.modules ?? []) visitModule(mod);

    return new Protocol(build, declsByFullname);
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
      case "IntType":
        return decoder.readInt();
      case "EnumType":
        return decoder.readInt();
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

  #indexEnums() {
    for (const [fullname, decl] of this.declsByFullname.entries()) {
      if (decl.type_info?.type !== "EnumType") continue;
      const map = new Map();
      for (const f of decl.type_info.fields ?? []) {
        const val = parseIntLiteral(f.value);
        if (val === null) continue;
        map.set(val, f.fullname || f.name);
      }
      this.enums.set(fullname, map);
    }
  }
}

module.exports = { Protocol };
