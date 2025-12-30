const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeRaceName } = require("../src/replay/normalize");

test("normalizeRaceName maps common localized values to canonical English races", () => {
  // Terran
  assert.equal(normalizeRaceName("Terran"), "Terran");
  assert.equal(normalizeRaceName("terran"), "Terran");
  assert.equal(normalizeRaceName("테란"), "Terran");

  // Zerg
  assert.equal(normalizeRaceName("Zerg"), "Zerg");
  assert.equal(normalizeRaceName("저그"), "Zerg");

  // Protoss
  assert.equal(normalizeRaceName("Protoss"), "Protoss");
  assert.equal(normalizeRaceName("프로토스"), "Protoss");

  // Random
  assert.equal(normalizeRaceName("Random"), "Random");
  assert.equal(normalizeRaceName("무작위"), "Random");
});

