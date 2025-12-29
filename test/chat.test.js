const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadChat } = require("../src");

test("loads chat and ping events (may be empty)", async () => {
  const replayPath = path.join(
    __dirname,
    "../test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay"
  );

  const chat = await loadChat(replayPath);

  assert.equal(typeof chat.replayId, "string");
  assert.equal(chat.replayId.length, 64);
  assert.equal(chat.baseBuild, 80949);
  assert.equal(chat.players.length, 2);
  assert.ok(Array.isArray(chat.messages));
  assert.ok(Array.isArray(chat.pings));

  for (const m of chat.messages.slice(0, 10)) {
    assert.ok(Number.isFinite(m.seconds));
    assert.equal(typeof m.text, "string");
    assert.equal(typeof m.playerName, "string");
  }

  for (let i = 1; i < chat.messages.length; i++) {
    assert.ok(chat.messages[i - 1].gameloop <= chat.messages[i].gameloop);
  }
});
