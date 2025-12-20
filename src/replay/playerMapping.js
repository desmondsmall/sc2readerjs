// @ts-check

/**
 * Builds a map from SC2 "event userId" (as used in game/message events) to `details.m_playerList` index.
 *
 * Tournament replays can have additional lobby users (observers/admin). In those cases, event userIds
 * are not guaranteed to be `0..playerCount-1`. We use tracker `SPlayerSetupEvent` to identify which
 * userIds correspond to actual participants and how they map to player slots.
 *
 * If tracker events aren't available, we fall back to an identity mapping for 0..playerCount-1.
 *
 * @param {import("./decode").ReplayDecodeContext} ctx
 * @param {number} playerCount
 * @returns {Promise<Map<number, number>>} eventUserId -> playerIndex
 */
async function buildEventUserIdToPlayerIndexMap(ctx, playerCount) {
  /** @type {Map<number, number>} */
  const map = new Map();
  for (let i = 0; i < playerCount; i++) map.set(i, i);

  let trackerEvents;
  try {
    trackerEvents = await ctx.readFile("replay.tracker.events");
  } catch {
    return map;
  }

  const EVENT = "NNet.Replay.Tracker.SPlayerSetupEvent";
  const fieldsByEventType = {
    [EVENT]: ["m_userId", "m_slotId", "m_type"],
  };

  /** @type {Array<{ userId: number, slotId: number }>} */
  const participants = [];

  for (const ev of ctx.protocol.iterateTrackerEvents(trackerEvents, {
    decode: "fields",
    eventTypes: [EVENT],
    fieldsByEventType,
  })) {
    const payload = ev.payload;
    if (!payload) continue;

    // `m_type` is a participant/spectator discriminator; `1` is the common "player" value.
    const type = Number(payload.m_type ?? -1);
    if (type !== 1) continue;

    const userIdRaw = payload.m_userId;
    const slotIdRaw = payload.m_slotId;
    if (userIdRaw === null || userIdRaw === undefined) continue;
    if (slotIdRaw === null || slotIdRaw === undefined) continue;

    const userId = Number(userIdRaw);
    const slotId = Number(slotIdRaw);
    if (!Number.isFinite(userId) || userId < 0) continue;
    if (!Number.isFinite(slotId) || slotId < 0) continue;

    participants.push({ userId, slotId });
  }

  if (participants.length === 0) return map;

  // Dedupe by userId and sort deterministically by slotId.
  const seenUserIds = new Set();
  const ordered = participants
    .filter((p) => {
      if (seenUserIds.has(p.userId)) return false;
      seenUserIds.add(p.userId);
      return true;
    })
    .sort((a, b) => a.slotId - b.slotId);

  // If slotIds already align with `details.m_playerList` indices, use them directly.
  const directSlots = ordered.every((p) => p.slotId < playerCount);
  if (directSlots) {
    for (const p of ordered) map.set(p.userId, p.slotId);
    return map;
  }

  // Otherwise, map by participant slot order.
  for (let i = 0; i < Math.min(playerCount, ordered.length); i++) {
    map.set(ordered[i].userId, i);
  }

  return map;
}

module.exports = { buildEventUserIdToPlayerIndexMap };

