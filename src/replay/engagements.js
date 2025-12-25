// @ts-check

const fs = require("fs/promises");
const path = require("path");

const { decodeReplay } = require("./decode");
const { decodeBufferToUtf8String } = require("../util/text");
const { gameLoopsToSeconds } = require("./time");

let cachedUnitInfo = null; // Map<string, { minerals?: number, vespene?: number, supply?: number, is_army?: boolean, is_worker?: boolean, is_building?: boolean }>

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

async function loadUnitInfo() {
  if (cachedUnitInfo) return cachedUnitInfo;
  const jsonPath = path.join(__dirname, "../data/units/unit_info.json");
  const raw = await fs.readFile(jsonPath, "utf8");
  /** @type {Record<string, Record<string, any>>} */
  const byRace = JSON.parse(raw);

  /** @type {Map<string, any>} */
  const map = new Map();
  for (const race of Object.keys(byRace)) {
    const entries = byRace[race];
    if (!entries || typeof entries !== "object") continue;
    for (const [unitKey, info] of Object.entries(entries)) {
      if (!unitKey) continue;
      map.set(String(unitKey).toLowerCase(), info);
    }
  }

  cachedUnitInfo = map;
  return map;
}

function tagKey(tagIndex, tagRecycle) {
  return `${tagIndex}:${tagRecycle}`;
}

function classifyUnitType(unitTypeName, unitInfo) {
  if (!unitTypeName) return { kind: "other", info: null };
  const key = unitTypeName.toLowerCase();
  const info = unitInfo.get(key) ?? null;
  if (!info) return { kind: "other", info: null };
  if (info.is_worker) return { kind: "worker", info };
  if (info.is_building) return { kind: "building", info };
  if (info.is_army) return { kind: "army", info };
  return { kind: "other", info };
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function mergeLoss(loss, add) {
  loss.count += add.count;
  loss.minerals += add.minerals;
  loss.vespene += add.vespene;
  loss.supply += add.supply;
}

function emptyLoss() {
  return { count: 0, minerals: 0, vespene: 0, supply: 0 };
}

/**
 * @typedef {object} LoadEngagementsOptions
 * @property {string} [protocolDir]
 * @property {number} [maxGapSeconds] Max time gap between death events in a single engagement.
 * @property {number} [maxDistance] Max (x/y) distance from engagement centroid to include a death event.
 * @property {number} [minArmyDeaths] Minimum total army-unit deaths required to keep an engagement.
 * @property {number} [minTotalValue] Minimum total (minerals+vespene) value lost required to keep an engagement.
 * @property {boolean} [includeTimeline] Include army-value timeline samples from tracker stats.
 */

/**
 * Detects "army engagements" by clustering tracker unit death events in time+space.
 * Intended for UI graphing: each engagement includes start/end time, location, and value lost by player.
 *
 * @param {string} replayPath
 * @param {LoadEngagementsOptions} [options]
 */
async function loadEngagements(replayPath, options = {}) {
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
        engagements: [],
        armyValueTimeline: options.includeTimeline === false ? undefined : players.map(() => []),
      };
    }

    const unitInfo = await loadUnitInfo();

    const UNIT_BORN = "NNet.Replay.Tracker.SUnitBornEvent";
    const UNIT_INIT = "NNet.Replay.Tracker.SUnitInitEvent";
    const UNIT_DONE = "NNet.Replay.Tracker.SUnitDoneEvent";
    const UNIT_TYPE_CHANGE = "NNet.Replay.Tracker.SUnitTypeChangeEvent";
    const UNIT_OWNER_CHANGE = "NNet.Replay.Tracker.SUnitOwnerChangeEvent";
    const UNIT_DIED = "NNet.Replay.Tracker.SUnitDiedEvent";
    const PLAYER_STATS = "NNet.Replay.Tracker.SPlayerStatsEvent";

    const maxGapSeconds = Number.isFinite(options.maxGapSeconds) ? options.maxGapSeconds : 10;
    const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : 20;
    const minArmyDeaths = Number.isFinite(options.minArmyDeaths) ? options.minArmyDeaths : 4;
    const minTotalValue = Number.isFinite(options.minTotalValue) ? options.minTotalValue : 300;
    const includeTimeline = options.includeTimeline !== false;

    /** @type {Map<string, { unitTypeName: string|null, controlPlayerId: number|null, upkeepPlayerId: number|null }>} */
    const units = new Map();

    /** @type {Array<{ id: number, startGameloop: number, endGameloop: number, startSeconds: number, endSeconds: number, center: {x:number,y:number}, radius: number, players: any[], totalValue: number, winnerUserId: number|null }>} */
    const engagements = [];

    /** @type {Array<Array<{ gameloop: number, seconds: number, minerals: number, vespene: number, total: number }>>} */
    const armyValueTimeline = includeTimeline ? players.map(() => []) : null;

    let nextEngagementId = 1;

    /** @type {null|{ startGameloop: number, startSeconds: number, endGameloop: number, endSeconds: number, sumX: number, sumY: number, count: number, lastSeconds: number, centerX: number, centerY: number, deaths: Array<any> }} */
    let active = null;

    const finalizeActive = () => {
      if (!active) return;

      /** @type {Array<{ userId: number, army: any, workers: any, buildings: any, total: any }>} */
      const perPlayer = players.map((p) => ({
        userId: p.userId,
        army: emptyLoss(),
        workers: emptyLoss(),
        buildings: emptyLoss(),
        total: emptyLoss(),
      }));

      let totalArmyDeaths = 0;
      let totalValue = 0;
      for (const d of active.deaths) {
        const p = perPlayer[d.userId];
        if (!p) continue;
        const loss = { count: 1, minerals: d.minerals, vespene: d.vespene, supply: d.supply };
        if (d.unitKind === "army") {
          mergeLoss(p.army, loss);
          totalArmyDeaths += 1;
        } else if (d.unitKind === "worker") {
          mergeLoss(p.workers, loss);
        } else if (d.unitKind === "building") {
          mergeLoss(p.buildings, loss);
        }
        mergeLoss(p.total, loss);
        totalValue += d.minerals + d.vespene;
      }

      const participants = perPlayer.filter((p) => p.total.count > 0);
      if (participants.length < 2) {
        active = null;
        return;
      }
      if (totalArmyDeaths < minArmyDeaths) {
        active = null;
        return;
      }
      if (totalValue < minTotalValue) {
        active = null;
        return;
      }

      let winnerUserId = null;
      if (participants.length >= 2) {
        const sorted = [...participants].sort(
          (a, b) => (a.total.minerals + a.total.vespene) - (b.total.minerals + b.total.vespene)
        );
        winnerUserId = sorted[0]?.userId ?? null;
      }

      engagements.push({
        id: nextEngagementId++,
        startGameloop: active.startGameloop,
        endGameloop: active.endGameloop,
        startSeconds: active.startSeconds,
        endSeconds: active.endSeconds,
        center: { x: active.centerX, y: active.centerY },
        radius: maxDistance,
        players: perPlayer,
        totalValue,
        winnerUserId,
      });

      active = null;
    };

    const addDeathToActive = (death) => {
      if (!active) {
        if (death.unitKind !== "army") return;
        active = {
          startGameloop: death.gameloop,
          startSeconds: death.seconds,
          endGameloop: death.gameloop,
          endSeconds: death.seconds,
          sumX: death.x,
          sumY: death.y,
          count: 1,
          lastSeconds: death.seconds,
          centerX: death.x,
          centerY: death.y,
          deaths: [death],
        };
        return;
      }

      const gapSeconds = death.seconds - active.lastSeconds;
      if (gapSeconds > maxGapSeconds) {
        finalizeActive();
        addDeathToActive(death);
        return;
      }

      if (dist2(death.x, death.y, active.centerX, active.centerY) > maxDistance * maxDistance) {
        finalizeActive();
        addDeathToActive(death);
        return;
      }

      active.deaths.push(death);
      active.endGameloop = death.gameloop;
      active.endSeconds = death.seconds;
      active.lastSeconds = death.seconds;
      active.sumX += death.x;
      active.sumY += death.y;
      active.count += 1;
      active.centerX = active.sumX / active.count;
      active.centerY = active.sumY / active.count;
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

      if (ev.eventType === UNIT_BORN || ev.eventType === UNIT_INIT || ev.eventType === UNIT_DONE) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const unitTypeName = decodeUnitTypeName(payload.m_unitTypeName) ?? null;
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

        units.set(key, {
          unitTypeName: unitTypeName ?? existing.unitTypeName,
          controlPlayerId:
            Number.isFinite(controlPlayerId) && controlPlayerId >= 0
              ? controlPlayerId
              : existing.controlPlayerId,
          upkeepPlayerId:
            Number.isFinite(upkeepPlayerId) && upkeepPlayerId >= 0
              ? upkeepPlayerId
              : existing.upkeepPlayerId,
        });
      } else if (ev.eventType === UNIT_TYPE_CHANGE) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const unitTypeName = decodeUnitTypeName(payload.m_unitTypeName) ?? null;
        const existing = units.get(key) ?? {
          unitTypeName: null,
          controlPlayerId: null,
          upkeepPlayerId: null,
        };
        units.set(key, { ...existing, unitTypeName: unitTypeName ?? existing.unitTypeName });
      } else if (ev.eventType === UNIT_OWNER_CHANGE) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

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
        units.set(key, {
          ...existing,
          controlPlayerId:
            Number.isFinite(controlPlayerId) && controlPlayerId >= 0
              ? controlPlayerId
              : existing.controlPlayerId,
          upkeepPlayerId:
            Number.isFinite(upkeepPlayerId) && upkeepPlayerId >= 0
              ? upkeepPlayerId
              : existing.upkeepPlayerId,
        });
      } else if (ev.eventType === PLAYER_STATS) {
        if (!includeTimeline || !armyValueTimeline) continue;
        const playerId = Number(payload.m_playerId ?? -1);
        if (!Number.isFinite(playerId) || playerId <= 0) continue;
        const userId = playerId - 1;
        if (userId < 0 || userId >= players.length) continue;
        const seconds = gameLoopsToSeconds(ev.gameloop, useScaledTime);
        const stats = payload.m_stats ?? null;
        if (!stats || typeof stats !== "object") continue;
        const minerals = Number(stats.m_scoreValueMineralsUsedActiveForces ?? 0);
        const vespene = Number(stats.m_scoreValueVespeneUsedActiveForces ?? 0);
        if (!Number.isFinite(minerals) || !Number.isFinite(vespene)) continue;
        armyValueTimeline[userId].push({
          gameloop: ev.gameloop,
          seconds,
          minerals,
          vespene,
          total: minerals + vespene,
        });
      } else if (ev.eventType === UNIT_DIED) {
        const tagIndex = Number(payload.m_unitTagIndex ?? -1);
        const tagRecycle = Number(payload.m_unitTagRecycle ?? -1);
        if (!Number.isFinite(tagIndex) || tagIndex < 0) continue;
        if (!Number.isFinite(tagRecycle) || tagRecycle < 0) continue;
        const key = tagKey(tagIndex, tagRecycle);

        const unitState = units.get(key) ?? null;
        const unitTypeName = unitState?.unitTypeName ?? null;
        const ownerPlayerId = unitState?.upkeepPlayerId ?? unitState?.controlPlayerId ?? null;
        if (!Number.isFinite(ownerPlayerId) || ownerPlayerId <= 0) continue;
        const userId = Number(ownerPlayerId) - 1;
        if (userId < 0 || userId >= players.length) continue;

        const x = Number(payload.m_x ?? NaN);
        const y = Number(payload.m_y ?? NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const seconds = gameLoopsToSeconds(ev.gameloop, useScaledTime);

        const { kind: unitKind, info } = classifyUnitType(unitTypeName, unitInfo);
        if (unitKind === "other") continue;

        const minerals = Number(info?.minerals ?? 0);
        const vespene = Number(info?.vespene ?? 0);
        const supply = Number(info?.supply ?? 0);

        addDeathToActive({
          userId,
          gameloop: ev.gameloop,
          seconds,
          x,
          y,
          unitTypeName,
          unitKind,
          minerals: Number.isFinite(minerals) ? minerals : 0,
          vespene: Number.isFinite(vespene) ? vespene : 0,
          supply: Number.isFinite(supply) ? supply : 0,
        });
      }
    }

    finalizeActive();

    for (const series of armyValueTimeline ?? []) series.sort((a, b) => a.gameloop - b.gameloop);
    engagements.sort((a, b) => a.startGameloop - b.startGameloop);

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild: header?.m_version?.m_baseBuild ?? null,
      build: header?.m_version?.m_build ?? null,
      useScaledTime,
      players,
      engagements,
      armyValueTimeline: armyValueTimeline ?? undefined,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadEngagements };
