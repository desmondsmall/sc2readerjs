// @ts-check

/**
 * Internal decode layer.
 *
 * This module centralizes the "open MPQ → select protocol → decode blobs" workflow and returns a
 * decode context that higher-level features (summary now, stats later) can build on.
 *
 * It is intentionally not exported from the public API.
 */

const path = require("path");
const { SC2MPQArchive } = require("../sc2mpq/sc2mpq");
const { loadProtocol, loadLatestProtocol } = require("../s2protocol/protocolLoader");
const { computeReplayId } = require("./replayId");

/**
 * @typedef {object} DecodeReplayOptions
 * @property {string} [protocolDir]
 */

/**
 * @typedef {object} ReplayDecodeContext
 * @property {string} replayId
 * @property {number|null} baseBuild
 * @property {import("../s2protocol/protocol").Protocol} protocol
 * @property {any} header
 * @property {any} details
 * @property {(name: string) => Promise<Buffer>} readFile
 * @property {() => Promise<void>} close
 */

// ---------------------------------------------------------------------------
// Module-level LRU cache for raw decompressed MPQ file bytes.
//
// Persists across calls for the lifetime of the process (Node.js module
// singleton). Multiple API calls on the same replay path share already-
// decompressed bytes without re-reading from disk.
//
// Key: `${absoluteReplayPath}:${internalFileName}`
// Default capacity: 128 MB. Evicts the least-recently-used entry when full.
// ---------------------------------------------------------------------------

const CACHE_DEFAULT_MAX_BYTES = 128 * 1024 * 1024; // 128 MB

class LRUByteCache {
  constructor(maxBytes = CACHE_DEFAULT_MAX_BYTES) {
    /** @type {Map<string, { buf: Buffer; size: number }>} */
    this._map = new Map();
    this._totalBytes = 0;
    this._maxBytes = maxBytes;
  }

  /** @returns {Buffer | undefined} */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    // Move to end → marks as most recently used
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.buf;
  }

  /** @param {string} key @param {Buffer} buf */
  set(key, buf) {
    const size = buf.length;
    if (size > this._maxBytes) return; // Single file too large to cache
    // Remove stale entry so its bytes aren't double-counted
    if (this._map.has(key)) {
      this._totalBytes -= this._map.get(key).size;
      this._map.delete(key);
    }
    // Evict LRU entries until there is room
    while (this._totalBytes + size > this._maxBytes) {
      const { value } = this._map.entries().next();
      this._map.delete(value[0]);
      this._totalBytes -= value[1].size;
    }
    this._map.set(key, { buf, size });
    this._totalBytes += size;
  }

  clear() {
    this._map.clear();
    this._totalBytes = 0;
  }
}

const _moduleCache = new LRUByteCache();

/** Clears the module-level replay file byte cache. */
function clearReplayFileCache() {
  _moduleCache.clear();
}

/**
 * Opens a replay, decodes the header and details, and returns a context object.
 * @param {string} replayPath
 * @param {DecodeReplayOptions} [options]
 * @returns {Promise<ReplayDecodeContext>}
 */
async function decodeReplay(replayPath, options = {}) {
  const protocolDir =
    options.protocolDir || path.join(__dirname, "../data/protocols");
  const absolutePath = path.resolve(replayPath);

  const archive = await SC2MPQArchive.open(replayPath);
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await archive.close();
  };

  try {
    const headerBytes = await archive.readReplayHeaderBytes();
    const latestProtocol = await loadLatestProtocol(protocolDir);
    const header = latestProtocol.decodeReplayHeader(headerBytes);

    const baseBuild = header?.m_version?.m_baseBuild ?? null;
    const protocol = await loadProtocol(protocolDir, baseBuild);

    /**
     * Per-call cache: avoids redundant reads within a single decodeReplay context.
     * @type {Map<string, Buffer>}
     */
    const callCache = new Map();

    /**
     * Reads an internal replay file, consulting caches in order:
     * 1. Per-call cache (same decodeReplay invocation)
     * 2. Module-level LRU cache (across calls for the same replay path)
     * 3. MPQ archive (disk I/O + decompression)
     * @param {string} name
     * @returns {Promise<Buffer>}
     */
    const readFile = async (name) => {
      if (callCache.has(name)) return callCache.get(name);

      const cacheKey = `${absolutePath}:${name}`;
      const cached = _moduleCache.get(cacheKey);
      if (cached) {
        callCache.set(name, cached);
        return cached;
      }

      const buf = await archive.readFile(name);
      _moduleCache.set(cacheKey, buf);
      callCache.set(name, buf);
      return buf;
    };

    const detailsBytes = await readFile("replay.details");
    const details = protocol.decodeReplayDetails(detailsBytes);

    let initDataBytes = Buffer.alloc(0);
    try {
      initDataBytes = await readFile("replay.initData");
    } catch {
      // Some edge-case replays may not include initData; keep id stable by hashing an empty blob.
    }

    const replayId = computeReplayId([headerBytes, detailsBytes, initDataBytes]);

    return {
      replayId,
      baseBuild,
      protocol,
      header,
      details,
      readFile,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { decodeReplay, clearReplayFileCache };
