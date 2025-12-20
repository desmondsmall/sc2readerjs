// @ts-check

const { decodeReplay } = require("./decode");
const { decodeBufferToUtf8String } = require("../util/text");
const { gameLoopsToSeconds } = require("./time");
const { resolveAbilityCommand } = require("./lookups/sc2reader");

/**
 * @typedef {object} LoadBuildCommandsOptions
 * @property {string} [protocolDir]
 * @property {boolean} [includeApm] Not used; accepted for symmetry with summary.
 */

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

function decodeTarget(data) {
  if (!data || typeof data !== "object") return null;
  const keys = Object.keys(data);
  if (keys.length !== 1) return null;
  const kind = keys[0];
  return { kind, value: data[kind] };
}

/**
 * Loads player-issued "build-like" commands (units/buildings/upgrades) from `replay.game.events`.
 *
 * This is intent-based: it reads `NNet.Game.SCmdEvent` and resolves ability ids to command names
 * using the vendored sc2reader lookup data in `data/sc2reader/`.
 *
 * @param {string} replayPath
 * @param {LoadBuildCommandsOptions} [options]
 */
async function loadBuildCommands(replayPath, options = {}) {
  const ctx = await decodeReplay(replayPath, options);
  try {
    const { protocol, header, details } = ctx;
    const useScaledTime = Boolean(header?.m_useScaledTime);

    const players =
      (details?.m_playerList ?? []).map((p) => ({
        name: decodeBufferToUtf8String(p?.m_name),
        race: decodeBufferToUtf8String(p?.m_race),
        commands: [],
      })) ?? [];

    const baseBuild = header?.m_version?.m_baseBuild ?? null;
    if (!Number.isFinite(baseBuild) || baseBuild === null) {
      throw new Error("Unable to determine baseBuild from replay header");
    }

    const gameEvents = await ctx.readFile("replay.game.events");
    const CMD_EVENT = "NNet.Game.SCmdEvent";

    for (const ev of protocol.iterateGameEvents(gameEvents, {
      decode: "full",
      eventTypes: [CMD_EVENT],
    })) {
      if (ev.eventType !== CMD_EVENT) continue;
      if (ev.userId < 0 || ev.userId >= players.length) continue;

      const payload = ev.payload;
      const abil = payload?.m_abil ?? null;
      if (!abil) continue;

      const abilityLink = Number(abil.m_abilLink ?? -1);
      const commandIndex = Number(abil.m_abilCmdIndex ?? -1);
      if (!Number.isFinite(abilityLink) || abilityLink < 0) continue;
      if (!Number.isFinite(commandIndex) || commandIndex < 0) continue;

      const resolved = await resolveAbilityCommand(baseBuild, abilityLink, commandIndex);
      if (!resolved) continue;

      const seconds = gameLoopsToSeconds(ev.gameloop, useScaledTime);
      const cmdFlags = Number(payload?.m_cmdFlags ?? 0);
      const queued = (cmdFlags & 0x2) !== 0;

      players[ev.userId].commands.push({
        userId: ev.userId,
        gameloop: ev.gameloop,
        seconds,
        queued,
        abilityLink,
        commandIndex,
        abilityName: resolved.abilityName,
        commandName: resolved.commandName,
        action: resolved.action,
        kind: resolved.kind,
        product: resolved.product,
        buildTimeSeconds: resolved.buildTimeSeconds,
        target: decodeTarget(payload?.m_data),
      });
    }

    for (const p of players) {
      p.commands.sort((a, b) => a.gameloop - b.gameloop);
    }

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild,
      build: header?.m_version?.m_build ?? null,
      useScaledTime,
      players,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadBuildCommands };

