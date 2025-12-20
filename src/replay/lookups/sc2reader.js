// @ts-check

const fs = require("fs/promises");
const path = require("path");

let cachedAbilityLookup = null; // Map<string, string[]>
let cachedTrainCommands = null; // Map<string, { product: string, buildTimeSeconds: number }>
const cachedAbilityLinkToNameByBuild = new Map(); // number -> Map<number,string>
let cachedLotvBaseAbilityLinkToName = null; // Map<number, string>
let cachedLotVAbilityBuilds = null; // number[]

function sc2readerDataRoot() {
  return path.resolve(__dirname, "../../../data/sc2reader");
}

function lotvDir() {
  return path.join(sc2readerDataRoot(), "LotV");
}

function mergeIdToNameMaps(baseMap, patchMap) {
  const merged = new Map(baseMap);
  for (const [id, name] of patchMap.entries()) merged.set(id, name);
  return merged;
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

async function loadLotVAbilityBuilds() {
  if (cachedLotVAbilityBuilds) return cachedLotVAbilityBuilds;
  const dir = lotvDir();
  const entries = await fs.readdir(dir);
  const builds = [];
  for (const name of entries) {
    const m = name.match(/^(\d+)_abilities\.csv$/);
    if (!m) continue;
    builds.push(Number(m[1]));
  }
  builds.sort((a, b) => a - b);
  cachedLotVAbilityBuilds = builds;
  return builds;
}

async function readAbilityLinkToNameCsv(csvPath) {
  const text = await fs.readFile(csvPath, "utf8");
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
  return map;
}

async function loadLotvBaseAbilityLinkToName() {
  if (cachedLotvBaseAbilityLinkToName) return cachedLotvBaseAbilityLinkToName;
  const basePath = path.join(lotvDir(), "base_abilities.csv");
  try {
    cachedLotvBaseAbilityLinkToName = await readAbilityLinkToNameCsv(basePath);
  } catch {
    cachedLotvBaseAbilityLinkToName = new Map();
  }
  return cachedLotvBaseAbilityLinkToName;
}

async function loadAbilityLinkToName(baseBuild) {
  if (cachedAbilityLinkToNameByBuild.has(baseBuild)) return cachedAbilityLinkToNameByBuild.get(baseBuild);

  // LotV-only "base pack" behavior:
  // - `LotV/base_abilities.csv` is the baseline mapping (stable-ish core ids).
  // - `LotV/${build}_abilities.csv` contains build-specific additions/overrides.
  // We load the base pack and overlay the best available build file:
  //   exact `build`, else closest LotV build <= baseBuild, else base-only.
  const builds = await loadLotVAbilityBuilds();
  const baseMap = await loadLotvBaseAbilityLinkToName();

  const fallbackBuild = builds.includes(baseBuild)
    ? baseBuild
    : [...builds].reverse().find((b) => b <= baseBuild) ?? null;

  if (fallbackBuild === null) {
    cachedAbilityLinkToNameByBuild.set(baseBuild, baseMap);
    return baseMap;
  }

  const chosenPath = path.join(lotvDir(), `${fallbackBuild}_abilities.csv`);
  try {
    const patchMap = await readAbilityLinkToNameCsv(chosenPath);
    const merged = mergeIdToNameMaps(baseMap, patchMap);
    cachedAbilityLinkToNameByBuild.set(baseBuild, merged);
    return merged;
  } catch {
    cachedAbilityLinkToNameByBuild.set(baseBuild, baseMap);
    return baseMap;
  }
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
