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
const { decodeBufferToUtf8String } = require("../util/text");
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

function normalizeReplayType(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (raw === 0) return "campaign";
    if (raw === 1) return "challenge";
    if (raw === 2) return "multiplayer";
    if (raw === 3) return "custom";
    return String(raw);
  }
  const s = String(raw);
  const last = s.split(".").pop() || s;
  const trimmed = last.startsWith("e_") ? last.slice(2) : last;
  return trimmed || null;
}

/**
 * Derive a human-readable team format (e.g., "1v1", "2v2", "ffa-4") from player teamIds.
 * Falls back to null when teamIds are missing or inconsistent.
 * @param {Array<{teamId: number | null}>} players
 */
function inferGameType(players) {
  const countsByTeam = new Map();
  for (const p of players) {
    if (p.teamId === null || p.teamId === undefined) continue;
    countsByTeam.set(p.teamId, (countsByTeam.get(p.teamId) ?? 0) + 1);
  }
  if (countsByTeam.size === 0) return null;

  const counts = Array.from(countsByTeam.values()).sort((a, b) => b - a);
  if (counts.length > 2 && counts.every((c) => c === 1)) {
    return `ffa-${counts.length}`;
  }
  return counts.join("v");
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

    const timeUtcSeconds = details?.m_timeUTC;
    const playedAt =
      typeof timeUtcSeconds === "number" && Number.isFinite(timeUtcSeconds)
        ? new Date(timeUtcSeconds * 1000).toISOString()
        : null;

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      build: header?.m_version?.m_build ?? null,
      durationSeconds: gameLoopsToSeconds(
        header?.m_elapsedGameLoops,
        header?.m_useScaledTime
      ),
      useScaledTime: Boolean(header?.m_useScaledTime),
      playedAt,
      gameType: inferGameType(players),
      mapTitle: decodeBufferToUtf8String(details?.m_title),
      replayType: normalizeReplayType(
        protocol.enumValueToName("NNet.Replay.EReplayType", header?.m_type) ?? header?.m_type
      ),
      players,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadReplaySummary };
