export interface ReplayVersion {
  m_major: number;
  m_minor: number;
  m_revision: number;
  m_build: number;
  m_baseBuild: number;
}

export interface ReplayHeader {
  m_signature: Buffer;
  m_version: ReplayVersion;
  m_type: number;
  m_elapsedGameLoops: number;
  m_useScaledTime: boolean;
  [key: string]: unknown;
}

export interface ReplayPlayerSummary {
  name: string | null;
  race: string | null;
  result: string | number | null;
  teamId: number | null;
  apm: number;
}

export interface ReplayDetails {
  m_title: Buffer;
  m_mapFileName?: Buffer;
  m_playerList?: Array<{
    m_name: Buffer;
    m_race: Buffer;
    m_result: number;
    m_teamId: number;
    [key: string]: unknown;
  }> | null;
  [key: string]: unknown;
}

export interface LoadReplaySummaryOptions {
  protocolDir?: string;
}

export interface ReplaySummary {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  durationSeconds: number;
  useScaledTime: boolean;
  mapTitle: string | null;
  mapFileName: string | null;
  replayType: string | number | null;
  signature: string | null;
  players: ReplayPlayerSummary[];
}

export function loadReplaySummary(
  replayPath: string,
  options?: LoadReplaySummaryOptions
): Promise<ReplaySummary>;

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
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  messages: ChatMessage[];
  pings: Ping[];
}

export interface LoadChatOptions {
  protocolDir?: string;
}

export function loadChat(
  replayPath: string,
  options?: LoadChatOptions
): Promise<ReplayChat>;

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
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ name: string | null; race: string | null; commands: BuildCommand[] }>;
}

export interface LoadBuildCommandsOptions {
  protocolDir?: string;
  includeUnresolved?: boolean;
}

export function loadBuildCommands(
  replayPath: string,
  options?: LoadBuildCommandsOptions
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
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  engagements: Engagement[];
  armyValueTimeline?: Array<ArmyValueSample[]>;
}

export interface LoadEngagementsOptions {
  protocolDir?: string;
  maxGapSeconds?: number;
  maxDistance?: number;
  minArmyDeaths?: number;
  minTotalValue?: number;
  includeTimeline?: boolean;
}

export function loadEngagements(
  replayPath: string,
  options?: LoadEngagementsOptions
): Promise<ReplayEngagements>;

export interface EcoSample {
  gameloop: number;
  seconds: number;
  workers: number;
  supplyUsed: number;
  supplyCap: number;
  bases: number;
}

export interface ReplayEcoTimeline {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: Array<{ userId: number; name: string | null; race: string | null }>;
  timeline: Array<EcoSample[]>;
}

export interface LoadEcoTimelineOptions {
  protocolDir?: string;
}

export function loadEcoTimeline(
  replayPath: string,
  options?: LoadEcoTimelineOptions
): Promise<ReplayEcoTimeline>;
