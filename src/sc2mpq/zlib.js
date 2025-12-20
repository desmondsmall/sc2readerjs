// @ts-check

/**
 * MPQ compression helper (zlib/deflate only).
 *
 * Some MPQ file sectors store a 1-byte compression "method" prefix followed by data.
 * SC2 replays typically use zlib/deflate (flag 0x02).
 *
 * `inflateMaybe` expects a Buffer containing [methodByte][payload...].
 */

const zlib = require("zlib");
const { bunzip2 } = require("./bzip2");

function inflate(data) {
  return new Promise((resolve, reject) => {
    zlib.inflate(data, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

function inflateRaw(data) {
  return new Promise((resolve, reject) => {
    zlib.inflateRaw(data, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

async function inflateMaybe(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length === 0) return data;

  const method = data[0] >>> 0;
  const payload = data.subarray(1);

  // MPQ "compression type" is a bitmask. SC2 commonly uses:
  // - 0x02 zlib/deflate
  // - 0x10 bzip2
  //
  // Decompression order in practice: bzip2 first (if present), then zlib.
  let out = payload;

  if ((method & 0x10) !== 0) {
    out = await bunzip2(out);
  }

  if ((method & 0x02) !== 0) {
    try {
      out = await inflate(out);
    } catch (e) {
      out = await inflateRaw(out);
    }
  }

  const unsupported = method & ~(0x02 | 0x10);
  if (unsupported !== 0) {
    throw new Error(
      `Unsupported MPQ compression flags 0x${method.toString(16)}`
    );
  }

  return out;
}

module.exports = { inflateMaybe };
