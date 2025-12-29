// @ts-check

const crypto = require("crypto");

const REPLAY_ID_PREFIX = "sc2readerjs-replayid-v1\0";

/**
 * Computes a deterministic replay id from stable internal replay blobs.
 *
 * We intentionally hash the extracted file bytes (not the raw `.SC2Replay` container) so the id is
 * resilient to MPQ-level packing differences while still uniquely identifying a replay file’s
 * contents.
 *
 * @param {Buffer[]} parts
 */
function computeReplayId(parts) {
  const hash = crypto.createHash("sha256");
  hash.update(REPLAY_ID_PREFIX, "utf8");

  for (const part of parts) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(buf.length >>> 0, 0);
    hash.update(len);
    hash.update(buf);
  }

  return hash.digest("hex");
}

module.exports = { computeReplayId };
