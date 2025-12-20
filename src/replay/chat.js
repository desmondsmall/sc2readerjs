// @ts-check

const { decodeReplay } = require("./decode");
const { decodeBufferToUtf8String } = require("../util/text");
const { gameLoopsToSeconds } = require("./time");
const { buildEventUserIdToPlayerIndexMap } = require("./playerMapping");

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

function normalizeEnumMember(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const last = value.split(".").pop() || value;
  return last.startsWith("e_") ? last.slice(2) : last;
}

/**
 * Loads chat messages and pings from `replay.message.events`.
 * @param {string} replayPath
 * @param {{protocolDir?: string}} [options]
 */
async function loadChat(replayPath, options = {}) {
  const ctx = await decodeReplay(replayPath, options);
  try {
    const { protocol, header, details } = ctx;
    const useScaledTime = Boolean(header?.m_useScaledTime);

    const players =
      (details?.m_playerList ?? []).map((p) => ({
        userId: null,
        name: decodeBufferToUtf8String(p?.m_name),
        race: decodeBufferToUtf8String(p?.m_race),
      })) ?? [];

    // For this API, `userId` refers to the normalized player index (0..playerCount-1).
    for (let i = 0; i < players.length; i++) players[i].userId = i;

    const eventUserIdToPlayerIndex = await buildEventUserIdToPlayerIndexMap(ctx, players.length);

    let messageEvents;
    try {
      messageEvents = await ctx.readFile("replay.message.events");
    } catch {
      return {
        patchVersion: formatPatchVersion(header?.m_version),
        baseBuild: header?.m_version?.m_baseBuild ?? null,
        build: header?.m_version?.m_build ?? null,
        useScaledTime,
        players,
        messages: [],
        pings: [],
      };
    }

    const CHAT_EVENT = "NNet.Game.SChatMessage";
    const PING_EVENT = "NNet.Game.SPingMessage";

    /** @type {Array<any>} */
    const messages = [];
    /** @type {Array<any>} */
    const pings = [];

    for (const ev of protocol.iterateMessageEvents(messageEvents, {
      decode: "full",
      eventTypes: [CHAT_EVENT, PING_EVENT],
    })) {
      const playerIndex = eventUserIdToPlayerIndex.get(ev.userId);
      if (playerIndex === undefined) continue;
      const seconds = gameLoopsToSeconds(ev.gameloop, useScaledTime);
      const playerName = players[playerIndex]?.name ?? `Player${playerIndex + 1}`;

      if (ev.eventType === CHAT_EVENT) {
        const recipient = normalizeEnumMember(
          protocol.enumValueToName("NNet.Game.EMessageRecipient", ev.payload?.m_recipient)
        );
        const text = decodeBufferToUtf8String(ev.payload?.m_string);
        if (!text) continue;
        messages.push({
          userId: playerIndex,
          sourceUserId: ev.userId,
          playerName,
          gameloop: ev.gameloop,
          seconds,
          recipient,
          toAllies: recipient === "allies",
          text,
        });
      } else if (ev.eventType === PING_EVENT) {
        const recipient = normalizeEnumMember(
          protocol.enumValueToName("NNet.Game.EMessageRecipient", ev.payload?.m_recipient)
        );
        const pt = ev.payload?.m_point ?? null;
        pings.push({
          userId: playerIndex,
          sourceUserId: ev.userId,
          playerName,
          gameloop: ev.gameloop,
          seconds,
          recipient,
          toAllies: recipient === "allies",
          point: pt,
        });
      }
    }

    messages.sort((a, b) => a.gameloop - b.gameloop);
    pings.sort((a, b) => a.gameloop - b.gameloop);

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild: header?.m_version?.m_baseBuild ?? null,
      build: header?.m_version?.m_build ?? null,
      useScaledTime,
      players,
      messages,
      pings,
    };
  } finally {
    await ctx.close();
  }
}

module.exports = { loadChat };
