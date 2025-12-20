// @ts-check

function gameLoopsToSeconds(gameLoops, useScaledTime) {
  const loops = Number(gameLoops ?? 0);
  const fps = useScaledTime ? 16 * 1.4 : 16;
  return loops / fps;
}

module.exports = { gameLoopsToSeconds };

