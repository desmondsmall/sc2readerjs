const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadEcoTimeline } = require("../src");

test("loads eco timeline samples (workers/supply/bases) from tracker stats", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const eco = await loadEcoTimeline(replayPath);

  assert.equal(eco.baseBuild, 80949);
  assert.equal(eco.players.length, 2);
  assert.equal(eco.timeline.length, 2);

  for (const series of eco.timeline) {
    assert.ok(Array.isArray(series));
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i - 1].gameloop <= series[i].gameloop);
    }
    for (const s of series.slice(0, 25)) {
      assert.ok(Number.isFinite(s.seconds));
      assert.ok(Number.isFinite(s.workers));
      assert.ok(Number.isFinite(s.supplyUsed));
      assert.ok(Number.isFinite(s.supplyCap));
      assert.ok(Number.isFinite(s.bases));
      assert.ok(s.workers >= 0);
      assert.ok(s.supplyUsed >= 0);
      assert.ok(s.supplyCap >= 0);
      assert.ok(s.bases >= 0);
    }
  }
});

