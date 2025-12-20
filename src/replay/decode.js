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

/**
 * @typedef {object} DecodeReplayOptions
 * @property {string} [protocolDir]
 */

/**
 * @typedef {object} ReplayDecodeContext
 * @property {number|null} baseBuild
 * @property {import("../s2protocol/protocol").Protocol} protocol
 * @property {any} header
 * @property {any} details
 * @property {(name: string) => Promise<Buffer>} readFile
 * @property {() => Promise<void>} close
 */

/**
 * Opens a replay, decodes the header and details, and returns a context object.
 * @param {string} replayPath
 * @param {DecodeReplayOptions} [options]
 * @returns {Promise<ReplayDecodeContext>}
 */
async function decodeReplay(replayPath, options = {}) {
  const protocolDir =
    options.protocolDir || path.join(__dirname, "../../data/protocols");

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

    const detailsBytes = await archive.readFile("replay.details");
    const details = protocol.decodeReplayDetails(detailsBytes);

    return { baseBuild, protocol, header, details, readFile: (name) => archive.readFile(name), close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { decodeReplay };
