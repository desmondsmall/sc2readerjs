// @ts-check

const { gameLoopsToSeconds } = require("../time");
const { buildEventUserIdToPlayerIndexMap } = require("../playerMapping");

/**
 * @param {import("../decode").ReplayDecodeContext} ctx
 * @param {number} playerCount
 * @returns {Promise<number[]>} APM per userId index (0..playerCount-1)
 */
async function computeAverageApmByUserId(ctx, playerCount) {
  const durationSeconds = gameLoopsToSeconds(
    ctx.header?.m_elapsedGameLoops,
    ctx.header?.m_useScaledTime
  );
  const minutes = durationSeconds / 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return new Array(playerCount).fill(0);

  const counts = new Array(playerCount).fill(0);
  const eventUserIdToPlayerIndex = await buildEventUserIdToPlayerIndexMap(ctx, playerCount);

  const gameEvents = await ctx.readFile("replay.game.events");
  for (const ev of ctx.protocol.iterateGameEvents(gameEvents)) {
    const playerIndex = eventUserIdToPlayerIndex.get(ev.userId);
    if (playerIndex === undefined || playerIndex < 0 || playerIndex >= playerCount) continue;
    // A minimal approximation of "actions" for APM:
    // - cmd (abilities / right click / etc.)
    // - selection changes
    // - control groups
    if (
      ev.eventType.endsWith(".SCmdEvent") ||
      ev.eventType.endsWith(".SSelectionDeltaEvent") ||
      ev.eventType.endsWith(".SControlGroupUpdateEvent")
    ) {
      counts[playerIndex] += 1;
    }
  }

  return counts.map((c) => c / minutes);
}

module.exports = { computeAverageApmByUserId };
