# sc2readerjs

Local, UI-oriented helpers for extracting structured data from StarCraft II `.SC2Replay` files.

This package is designed for replay browser apps (Electron, desktop, local indexing). The APIs return small, presentation-friendly objects that are easy to cache, search, and render.

## What this library does

- Opens `.SC2Replay` MPQ archives and reads named streams (header/details, game events, tracker events, message events).
- Selects the correct build-specific protocol schema (vendored in-repo) and decodes events.
- Produces higher-level “UI payloads” such as build orders, chat, engagements, and economy timelines.

The public API is exported from `sc2readerjs/src/index.js` and typed in `sc2readerjs/index.d.ts`.

## API overview

- `loadReplaySummary(replayPath, options?)`
- `loadBuildCommands(replayPath, options?)`
- `loadChat(replayPath, options?)`
- `loadEngagements(replayPath, options?)`
- `loadEcoTimeline(replayPath, options?)`

All functions:

- Take a filesystem `replayPath` (absolute or relative).
- Return times as both `gameloop` and derived `seconds` (using the replay’s scaled/unscaled time setting).
- Support `options.protocolDir` to override where protocol schemas are loaded from (advanced/mostly for development).

## Functions

### `loadReplaySummary(replayPath, options?)`

**Intended use**

- Fast “list view” and indexing: map, duration, patch/build, replay type, player names/races/results.
- Use as your primary DB row for each replay; everything else can be lazy-loaded.

**How it works (briefly)**

- Decodes `replay.header` + `replay.details` using the correct protocol for the replay build.
- Computes APM by reading game events.

**Returns**

- A small object (`ReplaySummary`) with patch/build info, map info, duration, and `players[]`.

**Response schema**

```ts
type ReplaySummary = {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  durationSeconds: number;
  useScaledTime: boolean;
  mapTitle: string | null;
  mapFileName: string | null;
  replayType: string | number | null;
  signature: string | null;
  players: Array<{
    name: string | null;
    race: string | null;
    result: string | number | null;
    teamId: number | null;
    apm: number;
  }>;
};
```

---

### `loadBuildCommands(replayPath, options?)`

**Intended use**

- Build order UI: “what was built/researched and when”.
- Search/facets: “games where player opened 2‑rax”, “fast third”, “upgrade timing”, “first tech building before X”.

**How it works (briefly)**

- Reads `replay.game.events` (player-issued commands).
- Resolves commands to a “build command” model using bundled lookup data in `sc2readerjs/data/sc2reader/*`.

**Returns**

- `players[]` with `commands[]`, each command including timing (`gameloop`, `seconds`), a resolved `commandName`, and classification fields (`action`, `kind`, `product`).

**Response schema**

```ts
type ReplayBuildCommands = {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{
    name: string | null;
    race: string | null;
    commands: BuildCommand[];
  }>;
};

type BuildCommand = {
  userId: number;
  sourceUserId?: number;
  gameloop: number;
  seconds: number;
  queued: boolean;
  abilityLink: number;
  commandIndex: number;
  abilityName: string | null;
  commandName: string | null;
  action: "train" | "build" | "warpIn" | "morph" | "upgradeTo" | "research" | "evolve" | "upgrade" | null;
  kind: "unit" | "building" | "upgrade" | null;
  product: string | null;
  buildTimeSeconds: number | null;
  target: { kind: "None" | "TargetPoint" | "TargetUnit" | "Data"; value: unknown } | null;
};
```

**Notes**

- Some fields (e.g. `abilityLink`) are included to preserve a stable identifier for debugging and future features, even if your UI doesn’t show them.

---

### `loadChat(replayPath, options?)`

**Intended use**

- Replay viewer overlays: chat log + minimap pings.
- Search: full-text chat search (store messages in SQLite FTS for local apps).
- UX: jump-to-time from a chat message/ping.

**How it works (briefly)**

- Reads `replay.message.events`.
- Normalizes event `userId` to the local `players[]` indices using `sc2readerjs/src/replay/playerMapping.js` so the result is consistent across replays/builds.

**Returns**

- `messages[]` and `pings[]`, each with `userId`, `playerName`, and timing.

**Response schema**

```ts
type ReplayChat = {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  messages: ChatMessage[];
  pings: Ping[];
};

type ChatMessage = {
  userId: number;
  sourceUserId?: number;
  playerName: string | null;
  gameloop: number;
  seconds: number;
  recipient: "all" | "allies" | "observers" | string | null;
  toAllies: boolean;
  text: string;
};

type Ping = {
  userId: number;
  sourceUserId?: number;
  playerName: string | null;
  gameloop: number;
  seconds: number;
  recipient: "all" | "allies" | "observers" | string | null;
  toAllies: boolean;
  point: unknown;
};
```

---

### `loadEngagements(replayPath, options?)`

**Intended use**

- “Key fights” UI: clickable list of engagements with time + location + losses.
- Timeline overlays: show fight windows on charts (army value, eco, APM, etc).
- Search/facets: “biggest fight”, “high worker damage”, “base-trade heavy games”.

**How it works (briefly)**

- Reads `replay.tracker.events`, primarily unit death events.
- Clusters unit deaths into engagements based on time gap (`maxGapSeconds`) and distance (`maxDistance`).
- Computes per-player losses (army/workers/buildings/total) using unit value data from `sc2readerjs/data/sc2reader/unit_info.json`.
- (Optional) Includes `armyValueTimeline` from tracker player stats for graphing.

**Returns**

- `engagements[]` with start/end time, approximate map `center`, per-player losses, and a simple `winnerUserId` heuristic.

**Response schema**

```ts
type ReplayEngagements = {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  engagements: Engagement[];
  armyValueTimeline?: Array<ArmyValueSample[]>;
};

type Engagement = {
  id: number;
  startGameloop: number;
  endGameloop: number;
  startSeconds: number;
  endSeconds: number;
  center: { x: number; y: number };
  radius: number;
  players: EngagementPlayerLoss[];
  totalValue: number;
  winnerUserId: number | null;
};

type EngagementPlayerLoss = {
  userId: number;
  army: EngagementLoss;
  workers: EngagementLoss;
  buildings: EngagementLoss;
  total: EngagementLoss;
};

type EngagementLoss = {
  count: number;
  minerals: number;
  vespene: number;
  supply: number;
};

type ArmyValueSample = {
  gameloop: number;
  seconds: number;
  minerals: number;
  vespene: number;
  total: number;
};
```

**Notes**

- This is meant for UI summarization. It does not attempt deep tactical analysis (unit comps, spells, positioning), only “where/when losses happened and how costly they were”.

---

### `loadEcoTimeline(replayPath, options?)`

**Intended use**

- Economy graph UI: workers/supply/bases over time.
- All-in/greed heuristics: “no 3rd by X”, “worker cut timing”, “supply blocks”, “post-fight recovery”.
- Search/facets: “fast 3rd”, “low worker count at 6:00”, “eco crash after first fight”.

**How it works (briefly)**

- Reads `replay.tracker.events`.
- Uses `SPlayerStatsEvent` to sample:
  - `workers` (`m_scoreValueWorkersActiveCount`)
  - `supplyUsed` (`m_scoreValueFoodUsed`)
  - `supplyCap` (`m_scoreValueFoodMade`)
- Tracks base count by maintaining unit state from tracker unit events and counting known town-hall unit types (CC/Nexus/Hatchery variants).

**Returns**

- `timeline[userId] = EcoSample[]` where each sample includes timing plus `{ workers, supplyUsed, supplyCap, bases }`.

**Response schema**

```ts
type ReplayEcoTimeline = {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  timeline: Array<EcoSample[]>;
};

type EcoSample = {
  gameloop: number;
  seconds: number;
  workers: number;
  supplyUsed: number;
  supplyCap: number;
  bases: number;
};
```

## Playground

For a quick manual sanity check and to see payload shapes:

- `node sc2readerjs/playground/dump-replay.js --help`
- `node sc2readerjs/playground/dump-replay.js --full`
- `node sc2readerjs/playground/dump-replay.js --eco`
