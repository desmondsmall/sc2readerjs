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

  // MPQ "compression type" is a bitmask; SC2 replays are expected to be zlib (0x02).
  if ((method & ~0x02) !== 0) {
    throw new Error(
      `Unsupported MPQ compression flags 0x${method.toString(16)}`
    );
  }
  if ((method & 0x02) === 0) return payload;

  try {
    return await inflate(payload);
  } catch (e) {
    // Some MPQs store raw deflate streams; try inflateRaw as a fallback.
    return await inflateRaw(payload);
  }
}

module.exports = { inflateMaybe };
