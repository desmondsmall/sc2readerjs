// @ts-check

const fs = require("fs/promises");
const path = require("path");

let cachedAbilityLookup = null; // Map<string, string[]>
let cachedTrainCommands = null; // Map<string, { product: string, buildTimeSeconds: number }>
const cachedAbilityLinkToNameByBuild = new Map(); // number -> Map<number,string>

function sc2readerDataRoot() {
  return path.resolve(__dirname, "../../../data/sc2reader");
}

async function loadAbilityLookup() {
  if (cachedAbilityLookup) return cachedAbilityLookup;
  const csvPath = path.join(sc2readerDataRoot(), "ability_lookup.csv");
  const text = await fs.readFile(csvPath, "utf8");
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split(",");
    const abilityName = parts[0];
    if (!abilityName) continue;
    map.set(abilityName, parts.slice(1));
  }
  cachedAbilityLookup = map;
  return map;
}

async function loadTrainCommands() {
  if (cachedTrainCommands) return cachedTrainCommands;
  const jsonPath = path.join(sc2readerDataRoot(), "train_commands.json");
  const raw = await fs.readFile(jsonPath, "utf8");
  /** @type {Record<string, [string, number]>} */
  const parsed = JSON.parse(raw);
  const map = new Map();
  for (const [commandName, value] of Object.entries(parsed)) {
    map.set(commandName, { product: value[0], buildTimeSeconds: value[1] });
  }
  cachedTrainCommands = map;
  return map;
}

async function loadAbilityLinkToName(baseBuild) {
  if (cachedAbilityLinkToNameByBuild.has(baseBuild)) {
    return cachedAbilityLinkToNameByBuild.get(baseBuild);
  }

  const root = sc2readerDataRoot();
  const candidates = [
    path.join(root, "LotV", `${baseBuild}_abilities.csv`),
    path.join(root, "HotS", `${baseBuild}_abilities.csv`),
    path.join(root, "WoL", `${baseBuild}_abilities.csv`),
    path.join(root, "LotV", "base_abilities.csv"),
    path.join(root, "HotS", "base_abilities.csv"),
    path.join(root, "WoL", "base_abilities.csv"),
  ];

  let text = null;
  for (const p of candidates) {
    try {
      text = await fs.readFile(p, "utf8");
      break;
    } catch {
      // continue
    }
  }

  if (text === null) {
    const map = new Map();
    cachedAbilityLinkToNameByBuild.set(baseBuild, map);
    return map;
  }

  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const idx = line.indexOf(",");
    if (idx <= 0) continue;
    const id = Number(line.slice(0, idx));
    const name = line.slice(idx + 1);
    if (!Number.isFinite(id) || !name) continue;
    map.set(id, name);
  }

  cachedAbilityLinkToNameByBuild.set(baseBuild, map);
  return map;
}

function classifyCommandName(commandName) {
  if (!commandName) return null;
  if (commandName.startsWith("Cancel")) return null;

  const rules = [
    { prefix: "Train", action: "train", kind: "unit" },
    { prefix: "Build", action: "build", kind: "building" },
    { prefix: "WarpIn", action: "warpIn", kind: "unit" },
    { prefix: "Morph", action: "morph", kind: "unit" },
    { prefix: "UpgradeTo", action: "upgradeTo", kind: "building" },
    { prefix: "Research", action: "research", kind: "upgrade" },
    { prefix: "Evolve", action: "evolve", kind: "upgrade" },
    { prefix: "Upgrade", action: "upgrade", kind: "upgrade" },
  ];

  for (const r of rules) {
    if (!commandName.startsWith(r.prefix)) continue;
    const name = commandName.slice(r.prefix.length);
    return { action: r.action, kind: r.kind, name: name || null };
  }

  return null;
}

async function resolveAbilityCommand(baseBuild, abilityLink, commandIndex) {
  const abilityLinkToName = await loadAbilityLinkToName(baseBuild);
  const abilityName = abilityLinkToName.get(abilityLink) ?? null;
  if (!abilityName) return null;

  const abilityLookup = await loadAbilityLookup();
  const commandNames = abilityLookup.get(abilityName);
  if (!commandNames) return null;

  const commandName = commandNames[commandIndex] || null;
  if (!commandName) return null;

  const classification = classifyCommandName(commandName);
  if (!classification) return null;

  const trainCommands = await loadTrainCommands();
  const fromTrainCommands = trainCommands.get(commandName) ?? null;

  return {
    abilityName,
    commandName,
    action: classification.action,
    kind: classification.kind,
    product: fromTrainCommands?.product ?? classification.name,
    buildTimeSeconds: fromTrainCommands?.buildTimeSeconds ?? null,
  };
}

module.exports = {
  resolveAbilityCommand,
};
