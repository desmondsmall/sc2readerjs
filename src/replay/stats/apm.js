// @ts-check

const { gameLoopsToSeconds } = require("../time");

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

  const gameEvents = await ctx.readFile("replay.game.events");
  for (const ev of ctx.protocol.iterateGameEvents(gameEvents)) {
    if (ev.userId < 0 || ev.userId >= playerCount) continue;
    // A minimal approximation of "actions" for APM:
    // - cmd (abilities / right click / etc.)
    // - selection changes
    // - control groups
    if (
      ev.eventType.endsWith(".SCmdEvent") ||
      ev.eventType.endsWith(".SSelectionDeltaEvent") ||
      ev.eventType.endsWith(".SControlGroupUpdateEvent")
    ) {
      counts[ev.userId] += 1;
    }
  }

  return counts.map((c) => c / minutes);
}

module.exports = { computeAverageApmByUserId };
