#!/usr/bin/env node
// @ts-check

/**
 * Dumps multiple `.SC2Replay` files into a single text file for grepping/spot-checking.
 *
 * Examples (run from repo root):
 *   node sc2readerjs/playground/dump-folder.js sc2readerjs/test_replays/DH2025 --out dh2025-dump.txt
 *   node sc2readerjs/playground/dump-folder.js sc2readerjs/test_replays/DH2025 --out dh2025-summary.txt --summary --limit 0
 *
 * Examples (run from sc2readerjs/):
 *   node playground/dump-folder.js test_replays/DH2025 --out dh2025-dump.txt
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  loadReplaySummary,
  loadBuildCommands,
  loadChat,
  loadEngagements,
  loadEcoTimeline,
} = require("../src");

const SC2READERJS_ROOT = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage:
  node playground/dump-folder.js [dir] [--out file] [--max N] [--limit N] [--full]
                                [--summary] [--build] [--chat] [--engagements] [--eco]
                                [--no-engagements]

Defaults:
  dir: test_replays/DH2025
  --out: (auto) dump-<foldername>.txt in current directory
  --limit 25  (limits displayed build commands + chat + engagements + eco)
  sections: (all) summary + build + chat + engagements + eco
`);
}

function parseArgs(argv) {
  const args = {
    dir: null,
    out: null,
    max: null,
    limit: 25,
    full: false,
    includeEngagements: true,
    // section selection
    summary: false,
    build: false,
    chat: false,
    engagements: false,
    eco: false,
    help: false,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a === "--out") {
      args.out = argv[++i] ?? null;
      continue;
    }
    if (a === "--max") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("`--max` must be a positive number");
      args.max = v;
      continue;
    }
    if (a === "--limit") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) throw new Error("`--limit` must be a non-negative number");
      args.limit = v;
      continue;
    }
    if (a === "--full") {
      args.full = true;
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
    rest.push(a);
  }

  args.dir = rest[0] ?? null;
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

  // Default behavior: dump everything (but limited unless --full).
  return {
    summary: true,
    build: true,
    chat: true,
    engagements: args.includeEngagements || args.full,
    eco: true,
  };
}

function resolveDir(inputPath) {
  const defaultRel = "test_replays/DH2025";
  const raw = inputPath ?? defaultRel;

  if (path.isAbsolute(raw)) return raw;

  const fromCwd = path.resolve(process.cwd(), raw);
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromRoot = path.resolve(SC2READERJS_ROOT, raw);
  if (fs.existsSync(fromRoot)) return fromRoot;

  const err = new Error(
    `Directory not found.\n` +
      `Tried:\n` +
      `- ${fromCwd}\n` +
      `- ${fromRoot}\n`
  );
  err.code = "ENOENT";
  throw err;
}

async function findReplaysRecursive(dir) {
  /** @type {string[]} */
  const out = [];

  /** @type {string[]} */
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;

    /** @type {import('fs').Dirent[]} */
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.toLowerCase().endsWith(".sc2replay")) out.push(full);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function safeStringify(value) {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const dir = resolveDir(args.dir);
  const folderName = path.basename(dir) || "replays";
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : path.resolve(process.cwd(), `dump-${folderName}.txt`);
  const sections = selectedSections(args);

  const replayPaths = await findReplaysRecursive(dir);
  const selected = args.max ? replayPaths.slice(0, args.max) : replayPaths;

  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
  const write = (s = "") => stream.write(String(s) + "\n");

  write(`# Dump folder: ${dir}`);
  write(`# Replays: ${selected.length}/${replayPaths.length}`);
  write(`# Sections: ${Object.entries(sections).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
  write(`# limit=${args.limit} full=${args.full}`);
  write("");

  let ok = 0;
  let failed = 0;

  for (const replayPath of selected) {
    const rel = path.relative(dir, replayPath) || path.basename(replayPath);
    write("######################################################################");
    write(`# ${rel}`);
    write(`# path: ${replayPath}`);
    write("######################################################################");

    try {
      const summary = sections.summary ? await loadReplaySummary(replayPath) : null;
      const buildCommands = sections.build ? await loadBuildCommands(replayPath) : null;
      const chat = sections.chat ? await loadChat(replayPath) : null;
      const engagements = sections.engagements
        ? await loadEngagements(replayPath, { includeTimeline: args.full })
        : null;
      const ecoTimeline = sections.eco ? await loadEcoTimeline(replayPath) : null;

      const emitSection = (name, data) => {
        if (!data) return;
        write("");
        write(`=== ${name} ===`);
        write(safeStringify(data));
      };

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

      ok += 1;
    } catch (error) {
      failed += 1;
      write("");
      write("=== ERROR ===");
      write(String(error?.stack || error));
    }

    write("");
  }

  await new Promise((resolve) => stream.end(resolve));
  process.stdout.write(`Wrote ${outPath}\nOK=${ok} FAILED=${failed}\n`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
