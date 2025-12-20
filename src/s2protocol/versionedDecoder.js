// @ts-check

/**
 * s2protocol "versioned" decoder.
 *
 * The replay header and replay details structures use a versioned encoding where each
 * value is prefixed by a 1-byte "kind" marker (array/blob/struct/etc.) followed by a VInt.
 *
 * This decoder exposes only the primitives needed for our current metadata use-cases.
 * Higher-level decoding is driven by `Protocol.decodeTypeInfo`.
 */

const { BitPackedBuffer, CorruptedError, TruncatedError } = require("./bitPacked");

class VersionedDecoder {
  constructor(contents) {
    this._buffer = new BitPackedBuffer(contents, "big");
  }

  done() {
    return this._buffer.done();
  }

  usedBits() {
    return this._buffer.usedBits();
  }

  byteAlign() {
    this._buffer.byteAlign();
  }

  skipInstance() {
    this._skipInstance();
  }

  _expectSkip(expected) {
    const got = this._buffer.readBits(8);
    if (got !== expected) throw new CorruptedError(`Expected skip ${expected}, got ${got}`);
  }

  _vint() {
    let b = this._buffer.readBits(8);
    const negative = (b & 1) !== 0;
    let result = (b >> 1) & 0x3f;
    let bits = 6;
    while ((b & 0x80) !== 0) {
      b = this._buffer.readBits(8);
      result |= (b & 0x7f) << bits;
      bits += 7;
    }
    return negative ? -result : result;
  }

  readArray(decodeElem) {
    this._expectSkip(0);
    const length = this._vint();
    const out = [];
    for (let i = 0; i < length; i++) out.push(decodeElem());
    return out;
  }

  readBitArray() {
    this._expectSkip(1);
    const length = this._vint();
    const bytes = Math.floor((length + 7) / 8);
    return { length, data: this._buffer.readAlignedBytes(bytes) };
  }

  readBlob() {
    this._expectSkip(2);
    const length = this._vint();
    return this._buffer.readAlignedBytes(length);
  }

  readBool() {
    this._expectSkip(6);
    return this._buffer.readBits(8) !== 0;
  }

  readFourCC() {
    this._expectSkip(7);
    return this._buffer.readAlignedBytes(4);
  }

  readInt() {
    this._expectSkip(9);
    return this._vint();
  }

  readOptional(decodeInner) {
    this._expectSkip(4);
    const exists = this._buffer.readBits(8) !== 0;
    return exists ? decodeInner() : null;
  }

  readChoice(fieldsByTag) {
    this._expectSkip(3);
    const tag = this._vint();
    const field = fieldsByTag.get(tag);
    if (!field) {
      this._skipInstance();
      return {};
    }
    return { [field.name]: field.decode() };
  }

  readStruct(fieldsByTag) {
    this._expectSkip(5);
    const result = {};
    const length = this._vint();
    for (let i = 0; i < length; i++) {
      const tag = this._vint();
      const field = fieldsByTag.get(tag);
      if (!field) {
        this._skipInstance();
        continue;
      }
      result[field.name] = field.decode();
    }
    return result;
  }

  _skipInstance() {
    const skip = this._buffer.readBits(8);
    if (skip === 0) {
      const length = this._vint();
      for (let i = 0; i < length; i++) this._skipInstance();
    } else if (skip === 1) {
      const length = this._vint();
      const bytes = Math.floor((length + 7) / 8);
      this._buffer.readAlignedBytes(bytes);
    } else if (skip === 2) {
      const length = this._vint();
      this._buffer.readAlignedBytes(length);
    } else if (skip === 3) {
      this._vint();
      this._skipInstance();
    } else if (skip === 4) {
      const exists = this._buffer.readBits(8) !== 0;
      if (exists) this._skipInstance();
    } else if (skip === 5) {
      const length = this._vint();
      for (let i = 0; i < length; i++) {
        this._vint();
        this._skipInstance();
      }
    } else if (skip === 6) {
      this._buffer.readAlignedBytes(1);
    } else if (skip === 7) {
      this._buffer.readAlignedBytes(4);
    } else if (skip === 8) {
      this._buffer.readAlignedBytes(8);
    } else if (skip === 9) {
      this._vint();
    } else {
      throw new CorruptedError(`Unknown skip type ${skip}`);
    }
  }
}

module.exports = { VersionedDecoder, CorruptedError, TruncatedError };
