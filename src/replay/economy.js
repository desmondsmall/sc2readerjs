// @ts-check

const { decodeReplay } = require("./decode");
const { decodeBufferToUtf8String } = require("../util/text");
const { gameLoopsToSeconds } = require("./time");

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

function tagKey(tagIndex, tagRecycle) {
  return `${tagIndex}:${tagRecycle}`;
}

/**
 * Minimal economy timeline for UI/search features.
 *
 * Uses `SPlayerStatsEvent` for workers + supply and tracker unit events for base count.
 *
 * @param {string} replayPath
 * @param {{protocolDir?: string}} [options]
 */
async function loadEcoTimeline(replayPath, options = {}) {
  const ctx = await decodeReplay(replayPath, options);
  try {
    const { header, details } = ctx;
    const useScaledTime = Boolean(header?.m_useScaledTime);

    const players =
      (details?.m_playerList ?? []).map((p, i) => ({
        userId: i,
        name: decodeBufferToUtf8String(p?.m_name),
        race: decodeBufferToUtf8String(p?.m_race),
      })) ?? [];

    let trackerEvents;
    try {
      trackerEvents = await ctx.readFile("replay.tracker.events");
    } catch {
      return {
        patchVersion: formatPatchVersion(header?.m_version),
        baseBuild: header?.m_version?.m_baseBuild ?? null,
        build: header?.m_version?.m_build ?? null,
        useScaledTime,
        players,
        timeline: players.map(() => []),
      };
    }

    const UNIT_BORN = "NNet.Replay.Tracker.SUnitBornEvent";
    const UNIT_INIT = "NNet.Replay.Tracker.SUnitInitEvent";
    const UNIT_DONE = "NNet.Replay.Tracker.SUnitDoneEvent";
    const UNIT_TYPE_CHANGE = "NNet.Replay.Tracker.SUnitTypeChangeEvent";
    const UNIT_OWNER_CHANGE = "NNet.Replay.Tracker.SUnitOwnerChangeEvent";
    const UNIT_DIED = "NNet.Replay.Tracker.SUnitDiedEvent";
    const PLAYER_STATS = "NNet.Replay.Tracker.SPlayerStatsEvent";

    const baseTypes = new Set([
      "commandcenter",
      "commandcenterflying",
      "orbitalcommand",
      "orbitalcommandflying",
      "planetaryfortress",
      "nexus",
      "hatchery",
      "lair",
      "hive",
    ]);

    /** @type {Map<string, { unitTypeName: string|null, controlPlayerId: number|null, upkeepPlayerId: number|null }>} */
    const units = new Map();

    /** @type {Map<string, { userId: number|null, isBase: boolean }>} */
    const baseByTag = new Map();

    /** @type {number[]} */
    const baseCounts = players.map(() => 0);

    /** @type {Array<Array<{ gameloop: number, seconds: number, workers: number, supplyUsed: number, supplyCap: number, bases: number }>>} */
    const timeline = players.map(() => []);

    const applyBaseState = (key, unitTypeName, ownerPlayerId) => {
      const typeLower = unitTypeName ? String(unitTypeName).toLowerCase() : null;
      const isBase = Boolean(typeLower && baseTypes.has(typeLower));

      const userId =
        Number.isFinite(ownerPlayerId) && ownerPlayerId > 0 ? Number(ownerPlayerId) - 1 : null;
      const normalizedUserId = userId !== null && userId >= 0 && userId < players.length ? userId : null;

      const prev = baseByTag.get(key) ?? { userId: null, isBase: false };
      if (prev.isBase && prev.userId !== null) baseCounts[prev.userId] = Math.max(0, baseCounts[prev.userId] - 1);
      if (isBase && normalizedUserId !== null) baseCounts[normalizedUserId] += 1;

      baseByTag.set(key, { userId: normalizedUserId, isBase });
    };

    const decodeUnitTypeName = (value) => decodeBufferToUtf8String(value);

    const wantedTrackerTypes = [
      UNIT_BORN,
      UNIT_INIT,
      UNIT_DONE,
      UNIT_TYPE_CHANGE,
      UNIT_OWNER_CHANGE,
      UNIT_DIED,
      PLAYER_STATS,
    ];

    for (const ev of ctx.protocol.iterateTrackerEvents(trackerEvents, {
      decode: "full",
      eventTypes: wantedTrackerTypes,
    })) {
      const payload = ev.payload;
      if (!payload) continue;

      if (
        ev.eventType === UNIT_BORN ||
        ev.eventType === UNIT_INIT ||
        ev.eventType === UNIT_DONE ||
        ev.eventType === UNIT_TYPE_CHANGE ||
        ev.eventType === UNIT_OWNER_CHANGE
      ) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const unitTypeName =
          ev.eventType === UNIT_OWNER_CHANGE ? null : decodeUnitTypeName(payload.m_unitTypeName) ?? null;
        const controlPlayerId =
          payload.m_controlPlayerId === null || payload.m_controlPlayerId === undefined
            ? null
            : Number(payload.m_controlPlayerId);
        const upkeepPlayerId =
          payload.m_upkeepPlayerId === null || payload.m_upkeepPlayerId === undefined
            ? null
            : Number(payload.m_upkeepPlayerId);

        const existing = units.get(key) ?? {
          unitTypeName: null,
          controlPlayerId: null,
          upkeepPlayerId: null,
        };

        const next = {
          unitTypeName: unitTypeName ?? existing.unitTypeName,
          controlPlayerId:
            Number.isFinite(controlPlayerId) && controlPlayerId >= 0
              ? controlPlayerId
              : existing.controlPlayerId,
          upkeepPlayerId:
            Number.isFinite(upkeepPlayerId) && upkeepPlayerId >= 0 ? upkeepPlayerId : existing.upkeepPlayerId,
        };

        units.set(key, next);

        const ownerPlayerId = next.upkeepPlayerId ?? next.controlPlayerId ?? null;
        applyBaseState(key, next.unitTypeName, ownerPlayerId);
      } else if (ev.eventType === UNIT_DIED) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const prev = baseByTag.get(key) ?? null;
        if (prev?.isBase && prev.userId !== null) {
          baseCounts[prev.userId] = Math.max(0, baseCounts[prev.userId] - 1);
        }
        baseByTag.delete(key);
        units.delete(key);
      } else if (ev.eventType === PLAYER_STATS) {
        const playerId = Number(payload.m_playerId ?? -1);
        if (!Number.isFinite(playerId) || playerId <= 0) continue;
        const userId = playerId - 1;
        if (userId < 0 || userId >= players.length) continue;

        const seconds = gameLoopsToSeconds(ev.gameloop, useScaledTime);
        const stats = payload.m_stats ?? null;
        if (!stats || typeof stats !== "object") continue;

        const workers = Number(stats.m_scoreValueWorkersActiveCount ?? 0);
        const supplyUsed = Number(stats.m_scoreValueFoodUsed ?? 0);
        const supplyCap = Number(stats.m_scoreValueFoodMade ?? 0);

        timeline[userId].push({
          gameloop: ev.gameloop,
          seconds,
          workers: Number.isFinite(workers) ? workers : 0,
          supplyUsed: Number.isFinite(supplyUsed) ? supplyUsed : 0,
          supplyCap: Number.isFinite(supplyCap) ? supplyCap : 0,
          bases: baseCounts[userId] ?? 0,
        });
      }
    }

    for (const series of timeline) series.sort((a, b) => a.gameloop - b.gameloop);

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild: header?.m_version?.m_baseBuild ?? null,
      build: header?.m_version?.m_build ?? null,
      useScaledTime,
      players,
      timeline,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadEcoTimeline };

