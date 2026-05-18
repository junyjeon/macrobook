/**
 * parser.js — Parse the macro-recorder foldable .txt format.
 *
 * Format:
 *   [NNN] type "summary"
 *       key: "JSON-escaped"
 *       key: bareword
 *       key: 42
 *       key: true
 *
 * Header lines start with '['. Body lines are indented (2+ whitespace).
 * Comments start with '#'. Blank lines are insignificant.
 */

const HEADER_RE = /^\[(\d+)\]\s+(\w+)(?:\s+(.*))?$/;
const BODY_RE = /^[ \t]{2,}(\w+):\s*(.*)$/;

/**
 * Coerce a raw value string into the right JS type.
 */
function parseValue(raw) {
  const s = String(raw).trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
}

/**
 * If the summary is a single quoted string, unquote it. Otherwise return
 * the raw text. This keeps complex headers like `"x" → [name="y"]` intact.
 */
function parseSummary(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2 && !s.slice(1, -1).includes('"')) {
    try { return JSON.parse(s); } catch {}
  }
  return s;
}

/**
 * Parse a single line into one of:
 *   { kind: 'header', seq, type, summary }
 *   { kind: 'body', key, value }
 *   null  (comment, blank, or malformed)
 */
function parseLine(line) {
  if (typeof line !== 'string') return null;
  if (line.trim() === '') return null;
  if (line.trimStart().startsWith('#')) return null;

  const header = line.match(HEADER_RE);
  if (header) {
    return {
      kind: 'header',
      seq: Number(header[1]),
      type: header[2],
      summary: parseSummary(header[3])
    };
  }

  const body = line.match(BODY_RE);
  if (body) {
    return {
      kind: 'body',
      key: body[1],
      value: parseValue(body[2])
    };
  }

  return null;
}

/**
 * Group headers with their indented body lines.
 *
 * @param {string} text
 * @returns {Array<{ seq: number, type: string, summary: string|null, fields: object }>}
 */
function parseFile(text) {
  if (typeof text !== 'string') return [];
  const events = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;

    if (parsed.kind === 'header') {
      if (current) events.push(current);
      current = {
        seq: parsed.seq,
        type: parsed.type,
        summary: parsed.summary,
        fields: {}
      };
    } else if (parsed.kind === 'body' && current) {
      current.fields[parsed.key] = parsed.value;
    }
  }
  if (current) events.push(current);
  return events;
}

module.exports = { parseLine, parseFile, parseValue, parseSummary };
