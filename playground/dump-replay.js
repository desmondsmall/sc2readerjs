#!/usr/bin/env node
// @ts-check

/**
 * Replay dump playground script.
 *
 * Run from the repo root or the `sc2readerjs/` directory:
 * - `node playground/dump-replay.js --limit 10`
 * - `node sc2readerjs/playground/dump-replay.js --limit 10`
 *
 * Fixtures:
 * - A "fixture" is a replay file path bundled in `sc2readerjs/test_replays/` (e.g. `DH2025/*`).
 * - If you omit `replayPath`, the script loads the fixture named by `--fixture`.
 * - List fixture names: `node playground/dump-replay.js --list-fixtures`
 * - Use a fixture: `node playground/dump-replay.js --fixture dh2025_finals_g2`
 *
 * Custom replays:
 * - Pass an explicit replay path (relative to the current directory or absolute):
 *   `node playground/dump-replay.js path/to/MyReplay.SC2Replay --full`
 */

const path = require("path");
const fs = require("fs");
const {
  loadReplaySummary,
  loadBuildCommands,
  loadChat,
  loadEngagements,
  loadEcoTimeline,
} = require("../src");

const SC2READERJS_ROOT = path.resolve(__dirname, "..");

const FIXTURES = {
  dh2025_finals_g2: "test_replays/DH2025/Finals - Solar vs Maru - G2 - Ultralove.SC2Replay",
  dh2025_finals_g5: "test_replays/DH2025/Finals - Solar vs Maru - G5 - Tokamak.SC2Replay",
  dh2025_ro8_serral_classic_g3: "test_replays/DH2025/Ro8 - Serral vs Classic - G3 - Incorporeal.SC2Replay",
  dh2025_qm_classic_clem_g1: "test_replays/DH2025/QM - Classic vs Clem - G1 - Torches.SC2Replay",
};

function resolveReplayPath(inputPath) {
  if (path.isAbsolute(inputPath)) return inputPath;

  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromSc2readerjsRoot = path.resolve(SC2READERJS_ROOT, inputPath);
  if (fs.existsSync(fromSc2readerjsRoot)) return fromSc2readerjsRoot;

  const err = new Error(
    `Replay file not found.\n` +
      `Tried:\n` +
      `- ${fromCwd}\n` +
      `- ${fromSc2readerjsRoot}\n`
  );
  err.code = "ENOENT";
  throw err;
}

function usage() {
  console.log(`Usage:
  node playground/dump-replay.js [replayPath] [--fixture name] [--list-fixtures]
                              [--limit N] [--no-engagements] [--eco] [--full]

Defaults:
  replayPath: (fixture) dh2025_finals_g2
  --fixture dh2025_finals_g2
  --limit 25  (limits displayed build commands + chat + engagements)
`);
}

function parseArgs(argv) {
  const args = {
    replayPath: null,
    fixture: "dh2025_finals_g2",
    listFixtures: false,
    limit: 25,
    includeEngagements: true,
    eco: false,
    full: false,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { ...args, help: true };
    if (a === "--list-fixtures") {
      args.listFixtures = true;
      continue;
    }
    if (a === "--fixture") {
      args.fixture = argv[++i] ?? null;
      continue;
    }
    if (a === "--no-engagements") {
      args.includeEngagements = false;
      continue;
    }
    if (a === "--eco") {
      args.eco = true;
      continue;
    }
    if (a === "--full") {
      args.full = true;
      continue;
    }
    if (a === "--limit") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) throw new Error("`--limit` must be a non-negative number");
      args.limit = v;
      continue;
    }
    rest.push(a);
  }

  args.replayPath = rest[0] ?? null;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (args.listFixtures) {
    console.log("Fixtures:");
    for (const [name, rel] of Object.entries(FIXTURES)) {
      console.log(`- ${name}: ${rel}`);
    }
    process.exit(0);
  }

  const replayPath = args.replayPath
    ? resolveReplayPath(args.replayPath)
    : (() => {
        const rel = FIXTURES[args.fixture];
        if (!rel) {
          throw new Error(
            `Unknown fixture "${args.fixture}". Use --list-fixtures to see available names.`
          );
        }
        return resolveReplayPath(path.resolve(SC2READERJS_ROOT, rel));
      })();

  const summary = await loadReplaySummary(replayPath);
  const buildCommands = await loadBuildCommands(replayPath);
  const chat = await loadChat(replayPath);
  const engagements =
    args.includeEngagements || args.full
      ? await loadEngagements(replayPath, { includeTimeline: args.full })
      : null;
  const ecoTimeline = args.eco || args.full ? await loadEcoTimeline(replayPath) : null;

  console.log("=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== Build Commands ===");
  if (args.full) {
    console.log(JSON.stringify(buildCommands, null, 2));
    console.log("\n=== Chat ===");
    console.log(JSON.stringify(chat, null, 2));
    if (engagements) {
      console.log("\n=== Engagements ===");
      console.log(JSON.stringify(engagements, null, 2));
    }
    if (ecoTimeline) {
      console.log("\n=== Eco Timeline ===");
      console.log(JSON.stringify(ecoTimeline, null, 2));
    }
    return;
  }

  const trimmedCommands = {
    ...buildCommands,
    players: buildCommands.players.map((p) => ({
      name: p.name,
      race: p.race,
      commands: p.commands.slice(0, args.limit),
      totalCommands: p.commands.length,
      totalResolvedCommands: p.commands.filter((c) => c.commandName !== null).length,
    })),
  };
  console.log(JSON.stringify(trimmedCommands, null, 2));

  console.log("\n=== Chat ===");
  const trimmedChat = {
    ...chat,
    messages: chat.messages.slice(0, args.limit),
    totalMessages: chat.messages.length,
    pings: chat.pings.slice(0, args.limit),
    totalPings: chat.pings.length,
  };
  console.log(JSON.stringify(trimmedChat, null, 2));

  if (engagements) {
    console.log("\n=== Engagements ===");
    const trimmedEngagements = {
      ...engagements,
      engagements: engagements.engagements.slice(0, args.limit),
      totalEngagements: engagements.engagements.length,
      armyValueTimeline: undefined,
    };
    console.log(JSON.stringify(trimmedEngagements, null, 2));
  }

  if (ecoTimeline) {
    console.log("\n=== Eco Timeline ===");
    const trimmedEco = {
      ...ecoTimeline,
      timeline: ecoTimeline.timeline.map((series) => series.slice(0, args.limit)),
      totalSamples: ecoTimeline.timeline.map((series) => series.length),
    };
    console.log(JSON.stringify(trimmedEco, null, 2));
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
