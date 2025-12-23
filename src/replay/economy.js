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

    // `m_x`/`m_y` are the tracker event position fields for units; we use them to cluster
    // town-hall locations and compute an "expansions" count that doesn't overcount macro hatcheries.
    const EXPANSION_CLUSTER_RADIUS = 12;
    const EXPANSION_CLUSTER_RADIUS2 = EXPANSION_CLUSTER_RADIUS * EXPANSION_CLUSTER_RADIUS;

    /** @type {Map<string, { unitTypeName: string|null, controlPlayerId: number|null, upkeepPlayerId: number|null, x: number|null, y: number|null }>} */
    const units = new Map();

    /** @type {Map<string, { userId: number|null, isBase: boolean, clusterIndex: number|null }>} */
    const baseByTag = new Map();

    /** @type {number[]} */
    const baseCounts = players.map(() => 0);

    /** @type {number[]} */
    const expansionCounts = players.map(() => 0);

    /** @type {Array<Array<{ x: number, y: number, n: number, activeCount: number }>>} */
    const expansionClustersByUserId = players.map(() => []);

    /** @type {Array<Array<{ gameloop: number, seconds: number, workers: number, supplyUsed: number, supplyCap: number, bases: number, expansions: number }>>} */
    const timeline = players.map(() => []);

    const findOrCreateExpansionCluster = (userId, x, y) => {
      const clusters = expansionClustersByUserId[userId];
      for (let i = 0; i < clusters.length; i++) {
        const cl = clusters[i];
        const dx = x - cl.x;
        const dy = y - cl.y;
        if (dx * dx + dy * dy <= EXPANSION_CLUSTER_RADIUS2) {
          // update centroid
          cl.n += 1;
          cl.x += (x - cl.x) / cl.n;
          cl.y += (y - cl.y) / cl.n;
          return i;
        }
      }
      clusters.push({ x, y, n: 1, activeCount: 0 });
      return clusters.length - 1;
    };

    const decCluster = (userId, clusterIndex) => {
      const clusters = expansionClustersByUserId[userId];
      const cl = clusters[clusterIndex];
      if (!cl) return;
      const prev = cl.activeCount;
      cl.activeCount = Math.max(0, cl.activeCount - 1);
      if (prev > 0 && cl.activeCount === 0) {
        expansionCounts[userId] = Math.max(0, expansionCounts[userId] - 1);
      }
    };

    const incCluster = (userId, clusterIndex) => {
      const clusters = expansionClustersByUserId[userId];
      const cl = clusters[clusterIndex];
      if (!cl) return;
      const prev = cl.activeCount;
      cl.activeCount += 1;
      if (prev === 0 && cl.activeCount > 0) expansionCounts[userId] += 1;
    };

    const applyBaseState = (key, unitTypeName, ownerPlayerId, x, y) => {
      const typeLower = unitTypeName ? String(unitTypeName).toLowerCase() : null;
      const isBase = Boolean(typeLower && baseTypes.has(typeLower));

      const userId =
        Number.isFinite(ownerPlayerId) && ownerPlayerId > 0 ? Number(ownerPlayerId) - 1 : null;
      const normalizedUserId = userId !== null && userId >= 0 && userId < players.length ? userId : null;

      const prev = baseByTag.get(key) ?? { userId: null, isBase: false, clusterIndex: null };

      // If base-ness and ownership didn't change:
      // - keep counts stable
      // - but we may still need to assign a cluster if we didn't have coordinates yet.
      if (prev.isBase === isBase && prev.userId === normalizedUserId) {
        if (
          isBase &&
          normalizedUserId !== null &&
          prev.clusterIndex === null &&
          Number.isFinite(x) &&
          Number.isFinite(y)
        ) {
          const clusterIndex = findOrCreateExpansionCluster(normalizedUserId, Number(x), Number(y));
          incCluster(normalizedUserId, clusterIndex);
          baseByTag.set(key, { userId: normalizedUserId, isBase, clusterIndex });
          return;
        }
        baseByTag.set(key, { ...prev });
        return;
      }

      if (prev.isBase && prev.userId !== null) {
        baseCounts[prev.userId] = Math.max(0, baseCounts[prev.userId] - 1);
        if (prev.clusterIndex !== null) decCluster(prev.userId, prev.clusterIndex);
      }

      let clusterIndex = null;
      if (isBase && normalizedUserId !== null) {
        baseCounts[normalizedUserId] += 1;

        if (Number.isFinite(x) && Number.isFinite(y)) {
          clusterIndex = findOrCreateExpansionCluster(normalizedUserId, Number(x), Number(y));
          incCluster(normalizedUserId, clusterIndex);
        }
      }

      baseByTag.set(key, { userId: normalizedUserId, isBase, clusterIndex });
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
          x: null,
          y: null,
        };

        const x = Number.isFinite(payload.m_x) ? Number(payload.m_x) : null;
        const y = Number.isFinite(payload.m_y) ? Number(payload.m_y) : null;

        const next = {
          unitTypeName: unitTypeName ?? existing.unitTypeName,
          controlPlayerId:
            Number.isFinite(controlPlayerId) && controlPlayerId >= 0
              ? controlPlayerId
              : existing.controlPlayerId,
          upkeepPlayerId:
            Number.isFinite(upkeepPlayerId) && upkeepPlayerId >= 0 ? upkeepPlayerId : existing.upkeepPlayerId,
          x: x ?? existing.x,
          y: y ?? existing.y,
        };

        units.set(key, next);

        const ownerPlayerId = next.upkeepPlayerId ?? next.controlPlayerId ?? null;
        applyBaseState(key, next.unitTypeName, ownerPlayerId, next.x, next.y);
      } else if (ev.eventType === UNIT_DIED) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const prev = baseByTag.get(key) ?? null;
        if (prev?.isBase && prev.userId !== null) {
          baseCounts[prev.userId] = Math.max(0, baseCounts[prev.userId] - 1);
          if (prev.clusterIndex !== null) decCluster(prev.userId, prev.clusterIndex);
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
          expansions: expansionCounts[userId] ?? 0,
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
