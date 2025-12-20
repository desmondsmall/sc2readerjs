class TruncatedError extends Error {}
class CorruptedError extends Error {}

class BitPackedBuffer {
  constructor(contents, endian = "big") {
    this._data = contents ? Buffer.from(contents) : Buffer.alloc(0);
    this._used = 0;
    this._next = 0;
    this._nextbits = 0;
    this._bigendian = endian === "big";
  }

  done() {
    return this._nextbits === 0 && this._used >= this._data.length;
  }

  usedBits() {
    return this._used * 8 - this._nextbits;
  }

  byteAlign() {
    this._nextbits = 0;
  }

  readAlignedBytes(bytes) {
    this.byteAlign();
    const end = this._used + bytes;
    const data = this._data.subarray(this._used, end);
    this._used = end;
    if (data.length !== bytes) throw new TruncatedError("Truncated");
    return data;
  }

  readBits(bits) {
    let result = 0;
    let resultbits = 0;
    while (resultbits !== bits) {
      if (this._nextbits === 0) {
        if (this.done()) throw new TruncatedError("Truncated");
        this._next = this._data[this._used] >>> 0;
        this._used += 1;
        this._nextbits = 8;
      }
      const copybits = Math.min(bits - resultbits, this._nextbits);
      const copy = this._next & ((1 << copybits) - 1);
      if (this._bigendian) {
        result |= copy << (bits - resultbits - copybits);
      } else {
        result |= copy << resultbits;
      }
      this._next >>>= copybits;
      this._nextbits -= copybits;
      resultbits += copybits;
    }
    return result >>> 0;
  }
}

module.exports = { BitPackedBuffer, TruncatedError, CorruptedError };

