/* Counts That Say Themselves — the rules. Pure functions: no DOM, no network.
   app.mjs hands every function here the text or JSON it fetched at run time. */

export const STATUS = { MATCH: 'MATCH', DIFFERS: 'DIFFERS', UNKNOWN: 'NOT YET KNOWN' };

/* A number as a sentence prints it: "265,480" -> 265480. */
export const parseCount = s => (s == null ? null : Number(String(s).replace(/,/g, '')));
export const fmt = n => (n == null || Number.isNaN(n) ? 'not yet known' : Number(n).toLocaleString('en-GB'));

export function statusOf(stated, recount) {
  if (stated == null || recount == null || Number.isNaN(stated) || Number.isNaN(recount)) return STATUS.UNKNOWN;
  return stated === recount ? STATUS.MATCH : STATUS.DIFFERS;
}

/* The line of `text` where `re` first matches: 1-based line number, the line, the match. */
export function locate(text, re) {
  if (typeof text !== 'string') return null;
  const m = re.exec(text);
  if (!m) return null;
  const before = text.slice(0, m.index);
  const line = before.split('\n').length;
  const start = before.lastIndexOf('\n') + 1;
  const endAt = text.indexOf('\n', m.index);
  return { line, text: text.slice(start, endAt < 0 ? text.length : endAt), match: m };
}

/* ── typed counts: digits written into the source next to a counted noun ──
   A number inside ${…} is computed; digits written as digits are typed. A
   number after "first", "top", "at most", "up to" is a cap, not a count, and
   is skipped. Nouns are the ones the estate's count sentences use. */
export const NOUNS = ['named blocks', 'function families', 'unique numbered lines', 'unique lines', 'blocks', 'categories', 'groups', 'families', 'repositories'];
const NOUN_RE = new RegExp(`(^|[^\\w$#.{-])(\\d{1,3}(?:,\\d{3})+|\\d{2,})\\s+(${NOUNS.map(n => n.replace(/ /g, '\\s+')).join('|')})\\b`, 'g');
const CAP_RE = /(first|top|at most|up to|max|limit|every)\s*$/i;

export function findTyped(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    NOUN_RE.lastIndex = 0;
    let m;
    while ((m = NOUN_RE.exec(ln))) {
      const at = m.index + m[1].length;
      if (CAP_RE.test(ln.slice(Math.max(0, at - 12), at))) continue;
      const trimmed = ln.trim();
      const comment = /^(\/\/|\/?\*|#|<!--)/.test(trimmed) || ln.slice(0, at).includes('// ');
      out.push({ line: i + 1, text: ln, number: parseCount(m[2]), noun: m[3].replace(/\s+/g, ' '), comment });
    }
  });
  return out;
}

/* ── recount rules over the stars data ───────────────────────────────────── */
export function starsCounts(blocksDoc, families, index) {
  const blocks = blocksDoc && Array.isArray(blocksDoc.blocks) ? blocksDoc.blocks : null;
  const syms = blocks ? new Set(blocks.map(b => b.symbol)) : null;
  const famKeys = families && typeof families === 'object' ? Object.keys(families) : null;
  const famSet = families ? new Set(Object.values(families).flat()) : null;
  return {
    blocksAll: blocks ? blocks.length : null,
    blocksNamedByKind: blocks ? blocks.filter(b => b.kind !== 'auto').length : null,
    blocksAuto: blocks ? blocks.filter(b => b.kind === 'auto').length : null,
    functionsSum: blocks ? blocks.reduce((s, b) => s + (b.functions || 0), 0) : null,
    familiesPerBlockSum: blocks && families ? blocks.reduce((s, b) => s + (families[b.symbol] || []).length, 0) : null,
    categories: blocksDoc && Array.isArray(blocksDoc.categories) ? blocksDoc.categories.length : null,
    groupKeys: famKeys ? famKeys.length : null,
    unnamedGroups: famKeys && syms ? famKeys.filter(g => !syms.has(g)).length : null,
    familiesDistinct: famSet ? famSet.size : null,
    repositories: blocks ? new Set(blocks.flatMap(b => (b.repos || []).map(r => r.replace(/^Ventusltd\//, '')))).size : null,
    apps: blocks ? blocks.filter(b => b.kind === 'app').length : null,
    indexFamilies: index ? index.families ?? null : null,
    indexLines: index ? index.lines ?? null : null,
    indexElements: index ? index.elements ?? null : null,
  };
}

/* LINES.md header: "265,480 unique lines, numbered 1 to 364,138." */
export function parseLinesHeader(text) {
  const m = /([\d,]+) unique lines, numbered ([\d,]+) to ([\d,]+)/.exec(text || '');
  return m ? { line: m[0], unique: parseCount(m[1]), first: parseCount(m[2]), last: parseCount(m[3]) } : null;
}

/* Streaming row counter for LINES.md: rows are "number<TAB>code". Nothing is kept
   but the counts, so 23 MB passes through without being held. */
export function lineRowCounter() {
  let carry = '', rows = 0, max = 0, min = Infinity, header = null, badOrder = 0, prev = 0;
  const take = ln => {
    if (header == null && /unique lines, numbered/.test(ln)) header = ln;
    const tab = ln.indexOf('\t');
    if (tab < 1 || tab > 7) return;
    const k = ln.slice(0, tab);
    if (!/^\d+$/.test(k)) return;
    const n = +k;
    rows++; if (n > max) max = n; if (n < min) min = n; if (n <= prev) badOrder++; prev = n;
  };
  return {
    push(chunk) { const parts = (carry + chunk).split('\n'); carry = parts.pop(); for (const p of parts) take(p); },
    end() { if (carry) take(carry); carry = ''; return { rows, max, min: rows ? min : null, header, badOrder }; },
    get rows() { return rows; },
  };
}

/* galaxy: iteration directories are NN-slug (build_iterations_index.py) */
export const ITER_DIR = /^(\d{2})-([a-z0-9-]+)$/;
