// @ts-check

/**
 * bzip2 decompression helper.
 *
 * Uses the pure-JS `seek-bzip` module (declared in package.json) so no external
 * binaries or Python runtime are required.
 */

const bz2 = require("seek-bzip");

/**
 * @param {Buffer} data
 * @returns {Promise<Buffer>}
 */
function bunzip2(data) {
  return Promise.resolve().then(() => {
    try {
      const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const decoded = bz2.decode(input);
      return Buffer.from(decoded);
    } catch (err) {
      throw new Error(`bzip2 decompress failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

module.exports = { bunzip2 };
