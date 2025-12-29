const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadEngagements } = require("../src");

test("loads engagements (may be empty)", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const engagements = await loadEngagements(replayPath, { includeTimeline: false });

  assert.equal(typeof engagements.replayId, "string");
  assert.equal(engagements.replayId.length, 64);
  assert.equal(engagements.baseBuild, 80949);
  assert.equal(engagements.players.length, 2);
  assert.ok(Array.isArray(engagements.engagements));
  assert.equal(engagements.armyValueTimeline, undefined);

  for (let i = 1; i < engagements.engagements.length; i++) {
    assert.ok(
      engagements.engagements[i - 1].startGameloop <= engagements.engagements[i].startGameloop
    );
  }

  for (const e of engagements.engagements.slice(0, 10)) {
    assert.ok(Number.isFinite(e.startSeconds));
    assert.ok(Number.isFinite(e.endSeconds));
    assert.ok(e.startSeconds <= e.endSeconds);
    assert.ok(Number.isFinite(e.center?.x));
    assert.ok(Number.isFinite(e.center?.y));
    assert.ok(Number.isFinite(e.radius));
    assert.equal(e.players.length, engagements.players.length);
    assert.ok(e.winnerUserId === null || (e.winnerUserId >= 0 && e.winnerUserId < 2));
    for (const p of e.players) {
      assert.ok(p.userId >= 0 && p.userId < 2);
      assert.ok(p.total.count >= 0);
      assert.ok(p.total.minerals >= 0);
      assert.ok(p.total.vespene >= 0);
    }
  }
});

test("can include army value timeline samples", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const engagements = await loadEngagements(replayPath);
  assert.equal(typeof engagements.replayId, "string");
  assert.equal(engagements.replayId.length, 64);
  assert.ok(Array.isArray(engagements.armyValueTimeline));
  assert.equal(engagements.armyValueTimeline.length, engagements.players.length);
});
