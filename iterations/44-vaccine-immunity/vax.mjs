/* Immunity — the pure part. Parsing a vaccine file the way cvaa/inoculate.mjs
   reads it (filename rule, front matter, the five sections, the js block), the
   public wording adaptation, and the registry integrity counts. No DOM, no
   network. Nothing here executes an antibody: its source is only ever text. */

/* cvaa/inoculate.mjs at the pinned commit: FILENAME, REQUIRED_SECTIONS, DOSES */
export const FILENAME = /^(\d{12})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const SECTIONS = ['Disease', 'Symptom', 'Antibody', 'Dose', 'Provenance'];
export const DOSES = ['every-loop', 'every-commit', 'every-deploy'];

/* The private word for illusion is never printed on this page. It is built
   from character codes so that it never appears in this source either. */
const PRIVATE = String.fromCharCode(109, 97, 121, 97);
const PRIVATE_RE = new RegExp(PRIVATE, 'gi');
export const hasPrivateWord = s => typeof s === 'string' && new RegExp(PRIVATE, 'i').test(s);
export function adapt(s) {
  if (typeof s !== 'string') return s;
  return s.replace(PRIVATE_RE, m => m === m.toUpperCase() ? 'ILLUSION' : (m[0] === m[0].toUpperCase() ? 'Illusion' : 'illusion'));
}

export function parseName(name) {
  const m = FILENAME.exec(name);
  if (m) return { ok: true, ts: m[1], slug: m[2] };
  const why = /^\d{14}-/.test(name) ? '14-digit timestamp; the rule is 12 digits'
    : /^\d+-/.test(name) ? `${name.match(/^\d+/)[0].length}-digit timestamp; the rule is 12 digits`
    : !/\.md$/.test(name) ? 'not a .md file'
    : 'not <12 digits>-<kebab-slug>.md';
  return { ok: false, why };
}

/* inoculate.mjs frontMatter(): same regex, same trimming */
export function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) { const k = line.match(/^(\w+):\s*"?([^"#]*?)"?\s*(#.*)?$/); if (k) meta[k[1]] = k[2].trim(); }
  return meta;
}

/* CRLF normalised exactly as inoculate.mjs does before parsing and hashing */
export const normalise = text => text.split('\r\n').join('\n');

export function parseVaccine(file, text) {
  const t = normalise(text);
  const name = parseName(file);
  const meta = frontMatter(t);
  const sections = {};
  const missing = [];
  const heads = [];
  for (const s of SECTIONS) {
    const m = new RegExp(`^${s}\s*$`, 'm').exec(t);
    if (!m) missing.push(s); else heads.push({ s, at: m.index, end: m.index + m[0].length });
  }
  heads.sort((a, b) => a.at - b.at);
  heads.forEach((h, i) => { sections[h.s] = t.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : t.length).trim(); });
  const code = t.match(/```js\n([\s\S]*?)\n```/)?.[1] || null;
  const problems = [];
  if (!meta) problems.push('missing front matter');
  else {
    if (name.ok && meta.vaccine !== name.slug) problems.push(`front matter vaccine "${meta.vaccine}" differs from the file slug`);
    if (name.ok && meta.generation !== name.ts) problems.push('front matter generation differs from the filename timestamp');
    if (!DOSES.includes(meta.dose)) problems.push(`dose "${meta.dose}" is not one of ${DOSES.join('|')}`);
  }
  for (const s of missing) problems.push(`missing section "${s}"`);
  if (!code) problems.push('no js antibody block');
  return { file, name, meta, sections, code, problems };
}

export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/* Lock status of one file: the lock is written by inoculate.mjs over the
   LF-normalised text. Git holds these files LF (.gitattributes eol=lf), so the
   raw-bytes digest is expected to be the same number; both are reported. */
export function lockStatus(lock, file, rawHex, lfHex) {
  if (!lock || !(file in lock)) return { state: 'NOT IN LOCK', detail: 'vaccines.lock has no entry for this file name' };
  if (rawHex == null) return { state: 'NOT COMPUTED', detail: 'the digest could not be computed in this browser' };
  if (lock[file] === rawHex) return { state: 'LOCKED', detail: 'sha256 of the file bytes equals the lock entry' };
  if (lfHex && lock[file] === lfHex) return { state: 'LOCKED', detail: 'sha256 of the CRLF-normalised text equals the lock entry (the raw bytes differ only in line endings)' };
  return { state: 'HASH DIFFERS', detail: `lock holds ${lock[file].slice(0, 12)}…, the file bytes hash to ${rawHex.slice(0, 12)}…` };
}

/* Ring order: the 12-digit timestamp, the only order. Names that break the rule
   are not placed; they are counted and listed with the reason. */
export function orderRing(names) {
  const placed = [], broken = [], others = [];
  for (const n of names) {
    const p = parseName(n);
    if (p.ok) placed.push({ file: n, ts: p.ts, slug: p.slug });
    else if (/\.md$/.test(n) || /^\d+-/.test(n)) broken.push({ file: n, why: p.why });
    else others.push(n);
  }
  placed.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.file < b.file ? -1 : 1));
  let dup = 0;
  for (let i = 1; i < placed.length; i++) if (placed[i].ts === placed[i - 1].ts) dup++;
  return { placed, broken, others, duplicateTimestamps: dup };
}

/* Edges, only when both ends exist and the front matter that names them was read. */
export function buildEdges(ring, parsed) {
  const idx = new Map(ring.map((v, i) => [v.slug, i]));
  const gen = [], dose = [], sup = [];
  const reasons = [];
  let prev = null;
  const lastOfDose = new Map();
  ring.forEach((v, i) => {
    const p = parsed.get(v.file);
    if (!p || !p.meta) return;
    if (p.meta.generation === v.ts) {
      if (prev != null) gen.push({ a: prev, b: i });
      prev = i;
    } else reasons.push(`${v.file}: generation "${p.meta.generation}" differs from its filename, so no generation edge`);
    if (DOSES.includes(p.meta.dose)) {
      if (lastOfDose.has(p.meta.dose)) dose.push({ a: lastOfDose.get(p.meta.dose), b: i, dose: p.meta.dose });
      lastOfDose.set(p.meta.dose, i);
    }
    if (p.meta.superseded_by) {
      if (idx.has(p.meta.superseded_by)) sup.push({ a: i, b: idx.get(p.meta.superseded_by) });
      else reasons.push(`${v.file}: superseded_by "${p.meta.superseded_by}" names no vaccine in the listing, so no edge`);
    }
  });
  return { gen, dose, sup, reasons };
}

/* Repositories named in prose, for "where does it lead" (name-match). */
export function reposNamed(text) {
  return [...new Set((String(text).match(/Ventusltd\/[A-Za-z0-9_.-]+/g) || []).map(s => s.replace(/[.]+$/, '')))];
}
