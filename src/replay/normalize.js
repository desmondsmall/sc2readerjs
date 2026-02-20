// @ts-check

const HTML_ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g;
const SP_TAG_RE = /<sp\s*\/>/gi;

/**
 * Normalize localized race names to stable English values.
 *
 * SC2 replays can store races in the player's locale (e.g. Korean "프로토스").
 * For API consumers it’s generally more useful to return a stable canonical value.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizeRaceName(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Normalize case for comparisons, but keep canonical output capitalization.
  const key = s.toLowerCase();

  // Terran
  if (
    key === "terran" ||
    key === "테란" ||
    key === "тeрран" ||
    key === "терран" ||
    key === "人类" ||
    key === "人類"
  ) {
    return "Terran";
  }

  // Zerg
  if (
    key === "zerg" ||
    key === "저그" ||
    key === "зерг" ||
    key === "虫族" ||
    key === "蟲族"
  ) {
    return "Zerg";
  }

  // Protoss
  if (
    key === "protoss" ||
    key === "프로토스" ||
    key === "протосс" ||
    key === "神族"
  ) {
    return "Protoss";
  }

  // Random
  if (
    key === "random" ||
    key === "무작위" ||
    key === "случайная" ||
    key === "随机" ||
    key === "隨機"
  ) {
    return "Random";
  }

  return s;
}

function decodeHtmlEntities(input) {
  // Minimal entity decoding for replay strings like `&lt;TWSTED&gt;<sp/>herO`.
  // Includes numeric entities for safety.
  return input.replace(
    HTML_ENTITY_RE,
    (_m, body) => {
      if (body === "lt") return "<";
      if (body === "gt") return ">";
      if (body === "amp") return "&";
      if (body === "quot") return '"';
      if (body === "apos") return "'";

      if (typeof body === "string" && body.startsWith("#x")) {
        const codePoint = parseInt(body.slice(2), 16);
        if (!Number.isFinite(codePoint)) return _m;
        return String.fromCodePoint(codePoint);
      }
      if (typeof body === "string" && body.startsWith("#")) {
        const codePoint = parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint)) return _m;
        return String.fromCodePoint(codePoint);
      }
      return _m;
    }
  );
}

/**
 * Normalize SC2-marked-up player names to a readable display string.
 * Examples:
 * - `&lt;TWSTED&gt;<sp/>herO` -> `<TWSTED> herO`
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizePlayerName(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  if (!s) return null;

  s = decodeHtmlEntities(s);
  // SC2 uses `<sp/>` as a "space" token in some strings.
  s = s.replace(SP_TAG_RE, " ");
  return s.trim() || null;
}

module.exports = { normalizeRaceName, normalizePlayerName };
