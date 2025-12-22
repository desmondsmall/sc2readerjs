// @ts-check

/**
 * High-level replay helper(s).
 *
 * `loadReplaySummary` is the user-facing API and returns a small, readable object.
 *
 * Internally it uses `decodeReplay` to:
 * - open the `.SC2Replay` MPQ container
 * - select the correct build-specific protocol schema
 * - decode the replay header + details blobs
 *
 * This is meant to stay lightweight: it does not parse event streams.
 */

const { decodeReplay } = require("./decode");
const { decodeBufferToUtf8String, normalizeFourCC } = require("../util/text");
const { computeAverageApmByUserId } = require("./stats/apm");
const { gameLoopsToSeconds } = require("./time");

/** @typedef {import("../../index").ReplaySummary} ReplaySummary */
/** @typedef {import("../../index").LoadReplaySummaryOptions} LoadReplaySummaryOptions */

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

/**
 * @param {string} replayPath
 * @param {LoadReplaySummaryOptions} [options]
 * @returns {Promise<ReplaySummary>}
 */
async function loadReplaySummary(replayPath, options = {}) {
  const ctx = await decodeReplay(replayPath, options);
  try {
    const { protocol, header, details } = ctx;

    const players =
      (details?.m_playerList ?? []).map((p) => ({
        name: decodeBufferToUtf8String(p?.m_name),
        race: decodeBufferToUtf8String(p?.m_race),
        result: protocol.enumValueToName("NNet.Game.EResultDetails", p?.m_result),
        teamId: p?.m_teamId ?? null,
        apm: 0,
      })) ?? [];

    const apmByUserId = await computeAverageApmByUserId(ctx, players.length);
    for (let i = 0; i < players.length; i++) {
      players[i].apm = apmByUserId[i] ?? 0;
    }

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild: header?.m_version?.m_baseBuild ?? null,
      build: header?.m_version?.m_build ?? null,
      durationSeconds: gameLoopsToSeconds(
        header?.m_elapsedGameLoops,
        header?.m_useScaledTime
      ),
      useScaledTime: Boolean(header?.m_useScaledTime),
      mapTitle: decodeBufferToUtf8String(details?.m_title),
      mapFileName: decodeBufferToUtf8String(details?.m_mapFileName),
      replayType: protocol.enumValueToName("NNet.Replay.EReplayType", header?.m_type),
      signature: normalizeFourCC(header?.m_signature),
      players,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadReplaySummary };
