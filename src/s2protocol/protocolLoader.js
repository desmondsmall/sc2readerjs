// @ts-check

/**
 * Loads protocol definitions from vendored s2protocol JSON files.
 *
 * StarCraft II replays are build-specific: the replay header includes `m_version.m_baseBuild`,
 * and that build selects which `protocol{build}.json` schema must be used to decode files.
 *
 * This module finds the latest available schema (for the initial header decode) and then
 * loads the exact schema for a replay's base build.
 */

const fs = require("fs/promises");
const path = require("path");
const { Protocol } = require("./protocol");

/** @type {Map<string, Protocol>} */
const protocolCache = new Map();
/** @type {Map<string, number>} */
const latestBuildCache = new Map();

async function listProtocolBuilds(protocolDir) {
  const entries = await fs.readdir(protocolDir);
  const builds = [];
  for (const name of entries) {
    const m = name.match(/^protocol(\d+)\.json$/);
    if (m) builds.push(Number(m[1]));
  }
  builds.sort((a, b) => a - b);
  return builds;
}

async function loadLatestProtocol(protocolDir) {
  if (!latestBuildCache.has(protocolDir)) {
    const builds = await listProtocolBuilds(protocolDir);
    if (builds.length === 0) throw new Error(`No protocol JSON files in ${protocolDir}`);
    latestBuildCache.set(protocolDir, builds[builds.length - 1]);
  }
  return loadProtocol(protocolDir, latestBuildCache.get(protocolDir));
}

async function loadProtocol(protocolDir, build) {
  if (!build) throw new Error("Build number is required to load a protocol");
  const key = `${protocolDir}:${build}`;
  if (protocolCache.has(key)) return protocolCache.get(key);
  const p = path.join(protocolDir, `protocol${build}.json`);
  const protocol = await Protocol.fromJsonFile(p);
  protocolCache.set(key, protocol);
  return protocol;
}

module.exports = { loadProtocol, loadLatestProtocol, listProtocolBuilds };
