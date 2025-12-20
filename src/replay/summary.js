const path = require("path");
const { SC2MPQArchive } = require("../sc2mpq/sc2mpq");
const { loadProtocol, loadLatestProtocol } = require("../s2protocol/protocolLoader");
const { decodeBufferToUtf8String, normalizeFourCC } = require("../util/text");

function formatPatchVersion(version) {
  const major = version?.m_major ?? 0;
  const minor = version?.m_minor ?? 0;
  const revision = version?.m_revision ?? 0;
  const build = version?.m_build ?? 0;
  return `${major}.${minor}.${revision}.${build}`;
}

function gameLoopsToSeconds(gameLoops, useScaledTime) {
  const loops = Number(gameLoops ?? 0);
  const fps = useScaledTime ? 16 * 1.4 : 16;
  return loops / fps;
}

async function loadReplaySummary(replayPath, options = {}) {
  const protocolDir =
    options.protocolDir || path.join(__dirname, "../../data/protocols");

  const archive = await SC2MPQArchive.open(replayPath);
  try {
    const headerBytes = await archive.readReplayHeaderBytes();
    const latestProtocol = await loadLatestProtocol(protocolDir);
    const header = latestProtocol.decodeReplayHeader(headerBytes);

    const baseBuild = header?.m_version?.m_baseBuild;
    const protocol = await loadProtocol(protocolDir, baseBuild);

    const detailsBytes = await archive.readFile("replay.details");
    const details = protocol.decodeReplayDetails(detailsBytes);

    const players =
      (details?.m_playerList ?? []).map((p) => ({
        name: decodeBufferToUtf8String(p?.m_name),
        race: decodeBufferToUtf8String(p?.m_race),
        result: protocol.enumValueToName("NNet.Game.EResultDetails", p?.m_result),
        teamId: p?.m_teamId ?? null,
      })) ?? [];

    return {
      patchVersion: formatPatchVersion(header?.m_version),
      baseBuild: header?.m_version?.m_baseBuild ?? null,
      build: header?.m_version?.m_build ?? null,
      durationSeconds: gameLoopsToSeconds(
        header?.m_elapsedGameLoops,
        header?.m_useScaledTime
      ),
      useScaledTime: Boolean(header?.m_useScaledTime),
      mapTitle: decodeBufferToUtf8String(details?.m_title),
      mapFileName: decodeBufferToUtf8String(details?.m_mapFileName),
      replayType: protocol.enumValueToName("NNet.Replay.EReplayType", header?.m_type),
      signature: normalizeFourCC(header?.m_signature),
      players,
      _raw: options.includeRaw ? { header, details } : undefined,
    };
  } finally {
    await archive.close();
  }
}

module.exports = { loadReplaySummary };
