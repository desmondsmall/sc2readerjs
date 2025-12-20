#!/usr/bin/env node
// @ts-check

/**
 * Replay dump playground script.
 *
 * Run from the `sc2readerjs/` directory:
 * - `node playground/dump-replay.js --no-apm --limit 10`
 *
 * Fixtures:
 * - A "fixture" is a replay file path bundled in `sc2readerjs/test_replays/`.
 * - If you omit `replayPath`, the script loads the fixture named by `--fixture`.
 * - List fixture names: `node playground/dump-replay.js --list-fixtures`
 * - Use a fixture: `node playground/dump-replay.js --fixture everDream --no-apm`
 *
 * Custom replays:
 * - Pass an explicit replay path (relative to `sc2readerjs/` or absolute):
 *   `node playground/dump-replay.js path/to/MyReplay.SC2Replay --full`
 */

const path = require("path");
const { loadReplaySummary, loadBuildCommands } = require("../src");

const FIXTURES = {
  everDream: "test_replays/5.0.0.80949/2020-07-28 - (T)Ocrucius VS (Z)Rairden.SC2Replay",
};

function usage() {
  console.log(`Usage:
  node playground/dump-replay.js [replayPath] [--fixture name] [--list-fixtures]
                              [--limit N] [--no-apm] [--full]

Defaults:
  replayPath: (fixture) everDream
  --fixture everDream
  --limit 25
`);
}

function parseArgs(argv) {
  const args = {
    replayPath: null,
    fixture: "everDream",
    listFixtures: false,
    limit: 25,
    includeApm: true,
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
    if (a === "--no-apm") {
      args.includeApm = false;
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
    ? path.resolve(process.cwd(), args.replayPath)
    : (() => {
        const rel = FIXTURES[args.fixture];
        if (!rel) {
          throw new Error(
            `Unknown fixture "${args.fixture}". Use --list-fixtures to see available names.`
          );
        }
        return path.resolve(process.cwd(), rel);
      })();

  const summary = await loadReplaySummary(replayPath, { includeApm: args.includeApm });
  const buildCommands = await loadBuildCommands(replayPath);

  console.log("=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== Build Commands ===");
  if (args.full) {
    console.log(JSON.stringify(buildCommands, null, 2));
    return;
  }

  const trimmed = {
    ...buildCommands,
    players: buildCommands.players.map((p) => ({
      name: p.name,
      race: p.race,
      commands: p.commands.slice(0, args.limit),
      totalCommands: p.commands.length,
    })),
  };
  console.log(JSON.stringify(trimmed, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
