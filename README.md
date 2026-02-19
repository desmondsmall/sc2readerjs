# sc2readerjs

Extracts structured data from StarCraft II replays with an API layer to return readable game information.

## API overview
The public API is exported from `sc2readerjs/src/index.js` and typed in `sc2readerjs/index.d.ts`.
- `loadReplaySummary(replayPath, options?)`
- `loadBuildCommands(replayPath, options?)`
- `loadChat(replayPath, options?)`
- `loadEngagements(replayPath, options?)`
- `loadEcoTimeline(replayPath, options?)`

All functions:

- Take a filesystem `replayPath` (absolute or relative).
- Return times as both `gameloop` and derived `seconds` (using the replay’s scaled/unscaled time setting).
- Support `options.protocolDir` to override where protocol schemas are loaded from (advanced/mostly for development).

## Replay IDs
Every API result includes a `replayId` field (a stable hex string) that is consistent across `loadReplaySummary`, `loadBuildCommands`, `loadChat`, etc., so consumers can correlate responses from different calls.

## API schema (TypeScript)
The source of truth for types is `sc2readerjs/index.d.ts`. This section mirrors the public API surface.

```ts
export type ReplayResult = "win" | "loss" | "tie" | "undecided" | "unknown";

export interface ReplayPlayerSummary {
  name: string | null;
  race: string | null;
  result: ReplayResult | null;
  teamId: number | null;
  apm: number; // integer APM (rounded up)
}

export interface ReplaySummary {
  replayId: string;
  patchVersion: string;
  build: number | null;
  durationSeconds: number;
  useScaledTime: boolean;
  playedAt: string | null;
  gameType: string | null;
  mapTitle: string | null;
  replayType: "campaign" | "challenge" | "multiplayer" | "custom" | string | null;
  players: ReplayPlayerSummary[];
}

export function loadReplaySummary(replayPath: string, options?: { protocolDir?: string }): Promise<ReplaySummary>;

export type ChatRecipient = "all" | "allies" | "observers" | string | null;

export interface ChatMessage {
  userId: number;
  sourceUserId?: number;
  playerName: string | null;
  gameloop: number;
  seconds: number;
  recipient: ChatRecipient;
  toAllies: boolean;
  text: string;
}

export interface Ping {
  userId: number;
  sourceUserId?: number;
  playerName: string | null;
  gameloop: number;
  seconds: number;
  recipient: ChatRecipient;
  toAllies: boolean;
  point: unknown;
}

export interface ReplayChat {
  replayId: string;
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  messages: ChatMessage[];
  pings: Ping[];
}

export function loadChat(replayPath: string, options?: { protocolDir?: string }): Promise<ReplayChat>;

export type BuildCommandAction =
  | "train"
  | "build"
  | "warpIn"
  | "morph"
  | "upgradeTo"
  | "research"
  | "evolve"
  | "upgrade";

export type BuildCommandKind = "unit" | "building" | "upgrade";
export type BuildCommandTargetKind = "None" | "TargetPoint" | "TargetUnit" | "Data";

export interface BuildCommandTarget {
  kind: BuildCommandTargetKind;
  value: unknown;
}

export interface BuildCommand {
  userId: number;
  sourceUserId?: number;
  gameloop: number;
  seconds: number;
  queued: boolean;
  abilityLink: number;
  commandIndex: number;
  abilityName: string | null;
  commandName: string | null;
  action: BuildCommandAction | null;
  kind: BuildCommandKind | null;
  product: string | null;
  buildTimeSeconds: number | null;
  target: BuildCommandTarget | null;
}

export interface ReplayBuildCommands {
  replayId: string;
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ name: string | null; race: string | null; commands: BuildCommand[] }>;
}

export function loadBuildCommands(
  replayPath: string,
  options?: { protocolDir?: string; includeUnresolved?: boolean }
): Promise<ReplayBuildCommands>;

export interface EngagementLoss {
  count: number;
  minerals: number;
  vespene: number;
  supply: number;
}

export interface EngagementPlayerLoss {
  userId: number;
  army: EngagementLoss;
  workers: EngagementLoss;
  buildings: EngagementLoss;
  total: EngagementLoss;
}

export interface Engagement {
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
}

export interface ArmyValueSample {
  gameloop: number;
  seconds: number;
  minerals: number;
  vespene: number;
  total: number;
}

export interface ReplayEngagements {
  replayId: string;
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  engagements: Engagement[];
  armyValueTimeline?: Array<ArmyValueSample[]>;
}

export function loadEngagements(
  replayPath: string,
  options?: {
    protocolDir?: string;
    maxGapSeconds?: number;
    maxDistance?: number;
    minArmyDeaths?: number;
    minTotalValue?: number;
    includeTimeline?: boolean;
  }
): Promise<ReplayEngagements>;

export interface EcoSample {
  gameloop: number;
  seconds: number;
  workers: number;
  supplyUsed: number;
  supplyCap: number;
  bases: number;
  expansions: number;
}

export interface ReplayEcoTimeline {
  replayId: string;
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  timeline: Array<EcoSample[]>;
}

export function loadEcoTimeline(replayPath: string, options?: { protocolDir?: string }): Promise<ReplayEcoTimeline>;
```
