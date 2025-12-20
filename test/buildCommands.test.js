const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadBuildCommands } = require("../src");

test("loads build commands (units/buildings/upgrades) from game events", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const result = await loadBuildCommands(replayPath);

  assert.equal(result.baseBuild, 80949);
  assert.equal(result.players.length, 2);

  const all = result.players.flatMap((p) => p.commands);
  assert.ok(all.length > 0);

  for (const c of all.slice(0, 50)) {
    assert.ok(Number.isFinite(c.gameloop));
    assert.ok(Number.isFinite(c.seconds));
    assert.equal(typeof c.abilityName, "string");
    assert.equal(typeof c.commandName, "string");
    assert.ok(c.kind === "unit" || c.kind === "building" || c.kind === "upgrade");
  }
});

