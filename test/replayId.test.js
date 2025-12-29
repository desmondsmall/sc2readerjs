const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadReplaySummary, loadBuildCommands, loadChat, loadEngagements, loadEcoTimeline } = require("../src");

test("replayId is consistent across API helpers for the same replay", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const [summary, build, chat, engagements, eco] = await Promise.all([
    loadReplaySummary(replayPath),
    loadBuildCommands(replayPath),
    loadChat(replayPath),
    loadEngagements(replayPath, { includeTimeline: false }),
    loadEcoTimeline(replayPath),
  ]);

  assert.equal(summary.replayId, build.replayId);
  assert.equal(summary.replayId, chat.replayId);
  assert.equal(summary.replayId, engagements.replayId);
  assert.equal(summary.replayId, eco.replayId);
});

