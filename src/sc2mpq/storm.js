// @ts-check

/**
 * Storm MPQ hashing/decryption helpers.
 *
 * MPQ hash/block tables are encrypted using Blizzard's Storm algorithm.
 * This module implements:
 * - `hashString` for MPQ filename/table-key hashing
 * - `decryptBytes` for in-place decryption of 32-bit words in a Buffer
 * - `decryptTable` for reading + decrypting MPQ tables from a file handle
 */

const cryptoBuffer = new Uint32Array(0x500);
let cryptoReady = false;

function cryptoInitialize() {
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    let idx = i;
    for (let j = 0; j < 5; j++) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const temp1 = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const temp2 = seed & 0xffff;
      cryptoBuffer[idx] = (temp1 | temp2) >>> 0;
      idx += 0x100;
    }
  }
}

function cryptoLookup(index) {
  if (!cryptoReady) {
    cryptoInitialize();
    cryptoReady = true;
  }
  return cryptoBuffer[index] >>> 0;
}

function hashString(key, hashType) {
  let seed1 = 0x7fed7fed >>> 0;
  let seed2 = 0xeeeeeeee >>> 0;
  const upper = String(key).toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const charCode = upper.charCodeAt(i) & 0xff;
    seed1 =
      (cryptoLookup(hashType * 0x100 + charCode) ^ (seed1 + seed2)) >>> 0;
    seed2 = (charCode + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
  }
  return seed1 >>> 0;
}

function decryptBytes(buffer, seed) {
  let s = seed >>> 0;
  let seed2 = 0xeeeeeeee >>> 0;
  for (let i = 0; i + 3 < buffer.length; i += 4) {
    seed2 = (seed2 + cryptoLookup(0x400 + (s & 0xff))) >>> 0;
    let result = buffer.readUInt32LE(i) >>> 0;
    result = (result ^ (s + seed2)) >>> 0;
    s = (((~s << 21) + 0x11111111) | (s >>> 11)) >>> 0;
    seed2 = (result + seed2 + (seed2 << 5) + 3) >>> 0;
    buffer.writeUInt32LE(result, i);
  }
}

async function decryptTable(reader, entries, name, offset) {
  const seed = hashString(name, 3) >>> 0;
  const count = entries * 4; // number of uint32 words (each entry is 4 words)
  const byteLength = count * 4;
  const buf = Buffer.alloc(byteLength);
  const { bytesRead } = await reader.read(buf, 0, byteLength, offset >>> 0);
  if (bytesRead !== byteLength) throw new Error("Unexpected EOF reading encrypted table");

  // decryptBytes uses the same seed schedule as the old per-word loop.
  decryptBytes(buf, seed);

  const table = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    table[i] = buf.readUInt32LE(i * 4) >>> 0;
  }
  return table;
}

module.exports = {
  hashString,
  decryptBytes,
  decryptTable,
};
