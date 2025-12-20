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
  const builds = await listProtocolBuilds(protocolDir);
  if (builds.length === 0) throw new Error(`No protocol JSON files in ${protocolDir}`);
  return loadProtocol(protocolDir, builds[builds.length - 1]);
}

async function loadProtocol(protocolDir, build) {
  if (!build) throw new Error("Build number is required to load a protocol");
  const p = path.join(protocolDir, `protocol${build}.json`);
  return Protocol.fromJsonFile(p);
}

module.exports = { loadProtocol, loadLatestProtocol, listProtocolBuilds };
