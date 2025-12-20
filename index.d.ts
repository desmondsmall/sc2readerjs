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
  apm: number | null;
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
  includeApm?: boolean;
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

export type BuildCommandKind = "unit" | "building" | "upgrade";

export interface BuildCommandTarget {
  kind: string;
  value: unknown;
}

export interface BuildCommand {
  userId: number;
  gameloop: number;
  seconds: number;
  queued: boolean;
  abilityLink: number;
  commandIndex: number;
  abilityName: string;
  commandName: string;
  action: string;
  kind: BuildCommandKind;
  product: string | null;
  buildTimeSeconds: number | null;
  target: BuildCommandTarget | null;
}

export interface ReplayBuildCommandsPlayer {
  name: string | null;
  race: string | null;
  commands: BuildCommand[];
}

export interface ReplayBuildCommands {
  patchVersion: string;
  baseBuild: number | null;
  build: number | null;
  useScaledTime: boolean;
  players: ReplayBuildCommandsPlayer[];
}

export interface LoadBuildCommandsOptions {
  protocolDir?: string;
}

export function loadBuildCommands(
  replayPath: string,
  options?: LoadBuildCommandsOptions
): Promise<ReplayBuildCommands>;
