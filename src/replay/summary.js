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
const { normalizePlayerName, normalizeRaceName } = require("./normalize");

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
 * Normalizes result enum names like `NNet.Game.EResultDetails.e_win` to simple strings like `win`.
 * @param {string | number | null} raw
 */
function normalizeResult(raw) {
  if (raw === null || raw === undefined) return null;
  const last = String(raw).split(".").pop() || String(raw);
  const trimmed = last.startsWith("e_") ? last.slice(2) : last;
  const v = trimmed.toLowerCase();

  // Common outcomes.
  if (v === "win" || v === "loss" || v === "tie" || v === "undecided") return v;
  return v ? "unknown" : null;
}

function normalizePlayedAtFields(value) {
  if (value === null || value === undefined) return { playedAt: null, playedAtMs: null };

  // `m_timeUTC` is `NNet.int64`. In SC2 replays it’s typically a Windows FILETIME:
  // 100-ns ticks since 1601-01-01, stored as int64.
  //
  // Many replays therefore require FILETIME -> Unix epoch conversion.
  const FILETIME_UNIX_EPOCH = 116444736000000000n; // 1970-01-01 in 100ns ticks

  /** @type {number} */
  let ms;

  if (typeof value === "bigint") {
    const ticks = value;
    if (ticks <= 0n) return { playedAt: null, playedAtMs: null };
    const unixTicks = ticks - FILETIME_UNIX_EPOCH;
    // 100ns -> ms = ticks / 10_000
    ms = Number(unixTicks / 10000n);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    // Fallback: some fields may decode into Numbers (or older replays may differ).
    const abs = Math.abs(value);
    if (abs >= 1e16) {
      // likely FILETIME in 100ns
      ms = Number((BigInt(Math.trunc(value)) - FILETIME_UNIX_EPOCH) / 10000n);
    } else if (abs >= 1e14) {
      // microseconds -> ms
      ms = value / 1000;
    } else if (abs >= 1e11) {
      // milliseconds
      ms = value;
    } else {
      // seconds
      ms = value * 1000;
    }
  } else {
    return { playedAt: null, playedAtMs: null };
  }

  if (!Number.isFinite(ms)) return { playedAt: null, playedAtMs: null };

  // Sanity bounds: SC2 release era onwards, and not wildly in the future.
  const earliest = Date.UTC(2010, 0, 1);
  const latest = Date.UTC(2100, 0, 1);
  if (ms < earliest || ms > latest) return { playedAt: null, playedAtMs: null };

  return {
    playedAtMs: Math.trunc(ms),
    playedAt: new Date(ms).toISOString(),
  };
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
        name: normalizePlayerName(decodeBufferToUtf8String(p?.m_name)),
        race: normalizeRaceName(decodeBufferToUtf8String(p?.m_race)),
        result: normalizeResult(
          protocol.enumValueToName("NNet.Game.EResultDetails", p?.m_result) ?? null
        ),
        teamId: p?.m_teamId ?? null,
        apm: 0,
      })) ?? [];

    const apmByUserId = await computeAverageApmByUserId(ctx, players.length);
    for (let i = 0; i < players.length; i++) {
      const raw = apmByUserId[i] ?? 0;
      players[i].apm = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 0;
    }

    const { playedAt, playedAtMs } = normalizePlayedAtFields(details?.m_timeUTC);

    return {
      replayId: ctx.replayId,
      patchVersion: formatPatchVersion(header?.m_version),
      build: header?.m_version?.m_build ?? null,
      durationSeconds: Math.ceil(
        gameLoopsToSeconds(header?.m_elapsedGameLoops, header?.m_useScaledTime)
      ),
      useScaledTime: Boolean(header?.m_useScaledTime),
      playedAt,
      playedAtMs,
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
