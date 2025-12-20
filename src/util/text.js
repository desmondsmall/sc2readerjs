// @ts-check

/**
 * Small text helpers.
 *
 * Protocol decoders frequently return Buffer blobs for strings. These helpers:
 * - convert Buffers to UTF-8 strings
 * - normalize FourCC-like buffers (strip NULs)
 */

function decodeBufferToUtf8String(value) {
  if (value === null || value === undefined) return null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const nul = buf.indexOf(0);
  const slice = nul >= 0 ? buf.subarray(0, nul) : buf;
  const s = slice.toString("utf8");
  return s;
}

function normalizeFourCC(value) {
  if (value === null || value === undefined) return null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("ascii").replace(/\u0000/g, "");
}

module.exports = { decodeBufferToUtf8String, normalizeFourCC };
