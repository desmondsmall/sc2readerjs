const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadReplaySummary } = require("../src");

test("loads basic replay summary fields", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const summary = await loadReplaySummary(replayPath);

  assert.equal(summary.baseBuild, 80949);
  assert.ok(summary.patchVersion.startsWith("5.0.0."));
  assert.ok(summary.durationSeconds > 0);

  assert.equal(summary.mapTitle, "Ever Dream LE");
  assert.equal(summary.players.length, 2);

  const names = summary.players.map((p) => p.name);
  assert.ok(names.includes("Rairden"));

  const races = summary.players.map((p) => p.race);
  assert.ok(races.includes("Terran"));
  assert.ok(races.includes("Zerg"));

  for (const p of summary.players) {
    assert.equal(typeof p.apm, "number");
    assert.ok(Number.isFinite(p.apm));
  }
});
