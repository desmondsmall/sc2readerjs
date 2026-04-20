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
  dh2025_qm_hero_reynor_g1:
    "test_replays/DH2025/QM  - herO vs Reynor - G1 - Persephone.SC2Replay",
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
                                 [--limit N] [--full] [--copy]
                                 [--summary] [--build] [--chat] [--engagements] [--eco]
                                 [--no-engagements] [-h|--help]

Defaults:
  replayPath: (fixture) dh2025_finals_g2
  --fixture dh2025_finals_g2
  --limit 25  (limits displayed build commands + chat + engagements + eco)

Section selection:
  - If you pass any of: --summary/--build/--chat/--engagements/--eco, only those sections print.
  - Examples:
    - summary only: node playground/dump-replay.js --summary
    - eco only: node playground/dump-replay.js --eco
    - summary + eco: node playground/dump-replay.js --summary --eco
`);
}

function parseArgs(argv) {
  const args = {
    replayPath: null,
    fixture: "dh2025_finals_g2",
    listFixtures: false,
    limit: 25,
    includeEngagements: true,
    full: false,
    copy: false,
    // section selection
    summary: false,
    build: false,
    chat: false,
    engagements: false,
    eco: false,
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
    if (a === "--summary") {
      args.summary = true;
      continue;
    }
    if (a === "--build" || a === "--build-commands") {
      args.build = true;
      continue;
    }
    if (a === "--chat") {
      args.chat = true;
      continue;
    }
    if (a === "--engagements") {
      args.engagements = true;
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
    if (a === "--copy" || a === "--clipboard") {
      args.copy = true;
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

function selectedSections(args) {
  const explicitlySelected =
    args.summary || args.build || args.chat || args.engagements || args.eco;

  if (explicitlySelected) {
    return {
      summary: args.summary,
      build: args.build,
      chat: args.chat,
      engagements: args.engagements,
      eco: args.eco,
    };
  }

  // Default behavior when no section flags are provided.
  return {
    summary: true,
    build: true,
    chat: true,
    engagements: args.includeEngagements || args.full,
    eco: args.eco || args.full,
  };
}

async function copyToClipboard(text) {
  const { spawn } = require("child_process");

  const candidates =
    process.platform === "darwin"
      ? [{ cmd: "pbcopy", args: [] }]
      : process.platform === "win32"
        ? [{ cmd: "clip", args: [] }]
        : [
            { cmd: "xclip", args: ["-selection", "clipboard"] },
            { cmd: "xsel", args: ["--clipboard", "--input"] },
          ];

  /** @type {Error[]} */
  const errors = [];
  for (const { cmd, args } of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
        const err = [];
        child.stderr.on("data", (c) => err.push(c));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `${cmd} exited with code ${code}: ${Buffer.concat(err).toString("utf8")}`.trim()
              )
            );
            return;
          }
          resolve();
        });
        child.stdin.end(text);
      });
      return;
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  const suffix =
    process.platform === "linux"
      ? "Install `xclip` or `xsel`, or run without `--copy`."
      : "Run without `--copy`.";
  const message =
    `Failed to copy to clipboard. ${suffix}\n` +
    errors.map((e) => `- ${e.message}`).join("\n");
  const err = new Error(message);
  err.code = "CLIPBOARD_ERROR";
  throw err;
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

  const sections = selectedSections(args);

  const summary = sections.summary ? await loadReplaySummary(replayPath) : null;
  const buildCommands = sections.build ? await loadBuildCommands(replayPath) : null;
  const chat = sections.chat ? await loadChat(replayPath) : null;
  const engagements = sections.engagements
    ? await loadEngagements(replayPath, { includeTimeline: args.full })
    : null;
  const ecoTimeline = sections.eco ? await loadEcoTimeline(replayPath) : null;

  /** @type {string[]} */
  const output = [];
  const out = (s = "") => output.push(String(s));

  function emitSection(name, data) {
    if (!data) return;
    if (output.length > 0) out("");
    out(`=== ${name} ===`);
    out(JSON.stringify(data, null, 2));
  }

  if (sections.summary) emitSection("Summary", summary);

  if (sections.build) {
    const data =
      args.full
        ? buildCommands
        : {
            ...buildCommands,
            players: buildCommands.players.map((p) => ({
              ...p,
              commands: p.commands.slice(0, args.limit),
            })),
          };
    emitSection("Build Commands", data);
  }

  if (sections.chat) {
    const data =
      args.full
        ? chat
        : {
            ...chat,
            messages: chat.messages.slice(0, args.limit),
          };
    emitSection("Chat", data);
  }

  if (sections.engagements) {
    const data =
      args.full
        ? engagements
        : {
            ...engagements,
            engagements: engagements.engagements.slice(0, args.limit),
          };
    emitSection("Engagements", data);
  }

  if (sections.eco) {
    const data =
      args.full
        ? ecoTimeline
        : {
            ...ecoTimeline,
            timeline: ecoTimeline.timeline.map((series) => series.slice(0, args.limit)),
          };
    emitSection("Eco Timeline", data);
  }

  const text = output.join("\n") + "\n";
  process.stdout.write(text);
  if (args.copy) await copyToClipboard(text);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
