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

/**
 * Builds that share an identical protocol with another build.
 * Derived from s2prot's Duplicates map (Apache 2.0, Andras Belicza):
 * https://github.com/icza/s2prot
 *
 * @type {Record<number, number>}
 */
const BUILD_ALIASES = {
  // 16561 group
  16605: 16561,
  16755: 16561,
  16939: 16561,
  // 17266 group
  17326: 17266,
  18092: 17266,
  // 18468 group
  18574: 18468,
  // 19458 group
  19595: 19458,
  19679: 19458,
  21029: 19458,
  // 27950 group
  28272: 27950,
  28667: 27950,
  // 48258 group
  48645: 48258,
  48960: 48258,
  49527: 48258,
  49716: 48258,
  49957: 48258,
  51149: 48258,
  51702: 48258,
  52910: 48258,
  53644: 48258,
  // 54724 group
  55505: 54724,
  55958: 54724,
  56787: 54724,
  57218: 54724,
  57490: 54724,
  57507: 54724,
  // 59587 group
  60196: 59587,
  60321: 59587,
  62347: 59587,
  62848: 59587,
  63454: 59587,
  // 64469 group
  65094: 64469,
  65384: 64469,
  // 65895 group
  66668: 65895,
  67188: 65895,
  67926: 65895,
  69232: 65895,
  // 70154 group
  71061: 70154,
  71523: 70154,
  71663: 70154,
  72282: 70154,
  73286: 70154,
  73559: 70154,
  73620: 70154,
  74071: 70154,
  74456: 70154,
  74741: 70154,
  75025: 70154,
  // 75800 group
  76052: 75800,
  76114: 75800,
  76811: 75800,
  // 77379 group
  77535: 77379,
  77661: 77379,
  78285: 77379,
  79998: 77379,
  80188: 77379,
  // 80949 group
  81009: 80949,
  81102: 80949,
  81433: 80949,
  82457: 80949,
  82893: 80949,
  83830: 80949,
  84643: 80949,
  86383: 80949,
  87702: 80949,
  88500: 80949,
  89165: 80949,
  89634: 80949,
  89720: 80949,
  90136: 80949,
  90779: 80949,
  90870: 80949,
  91046: 80949,
  91115: 80949,
  92028: 80949,
  92138: 80949,
  92174: 80949,
  92440: 80949,
  93272: 80949,
  93333: 80949,
  94137: 80949,
  95248: 80949,
  95299: 80949,
  95841: 80949,
};

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
  const resolved = BUILD_ALIASES[build] ?? build;
  const key = `${protocolDir}:${resolved}`;
  if (protocolCache.has(key)) return protocolCache.get(key);
  const p = path.join(protocolDir, `protocol${resolved}.json`);
  const protocol = await Protocol.fromJsonFile(p);
  protocolCache.set(key, protocol);
  return protocol;
}

module.exports = { loadProtocol, loadLatestProtocol, listProtocolBuilds };
