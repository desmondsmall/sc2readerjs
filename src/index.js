// @ts-check

/**
 * Public API entrypoint for sc2readerjs.
 *
 * This package is intentionally layered:
 * - `src/sc2mpq/*` extracts named files from `.SC2Replay` MPQ archives
 * - `src/s2protocol/*` decodes extracted binary blobs using the vendored protocol JSON schemas
 * - `src/replay/*` exposes user-friendly helpers built on top of those layers
 *
 * `loadReplaySummary` is the current high-level helper.
 */

/** @type {typeof import("../index")} */
const api = require("./replay/summary");

module.exports = api;
