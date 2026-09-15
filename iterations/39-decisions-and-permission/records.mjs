/* No Record, No Permission — the arithmetic, with no DOM.
   Reads the rules out of stars decisions/SCHEMA.md, checks each decision record
   against them, answers "what may be done on this key", and places records on
   a 19 x 19 board by their permanent number. */

/* ── SCHEMA.md → rules ─────────────────────────────────────────────────────
   The field table is parsed at run time, so the page checks the schema as it
   is published, not a typed copy of it. Throws when the table cannot be read. */
export function parseSchema(md) {
  const fields = new Map();
  for (const line of String(md).split('\n')) {
    const m = line.match(/^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|\s*(.*)\|\s*$/);
    if (m) fields.set(m[1], { name: m[1], required: m[2].trim().toLowerCase(), meaning: m[3].trim() });
  }
  if (!fields.size) throw new Error('SCHEMA.md has no field table this page can read');
  for (const need of ['id', 'subject', 'status', 'consequences']) {
    if (!fields.has(need)) throw new Error(`SCHEMA.md field table has no \`${need}\` row`);
  }
  const statusRow = fields.get('status').meaning;
  const statuses = [...statusRow.matchAll(/`([a-z]+)`/g)].map(x => x[1]);
  const subjRow = fields.get('subject').meaning;
  const typeList = subjRow.match(/"type":\s*((?:"[a-z]+"\s*(?:\\\||\|)?\s*)+)/);
  const subjectTypes = typeList ? [...typeList[1].matchAll(/"([a-z]+)"/g)].map(x => x[1]) : [];
  const prefixes = [...new Set([...subjRow.matchAll(/`([a-z]+):[^`]*`/g)].map(x => x[1]))];
  if (!statuses.length) throw new Error('SCHEMA.md status row names no statuses');
  if (!subjectTypes.length) throw new Error('SCHEMA.md subject row names no subject types');
  if (!prefixes.length) throw new Error('SCHEMA.md subject row names no key forms');
  return { fields, statuses, subjectTypes, prefixes };
}

/* ── keys ─────────────────────────────────────────────────────────────────── */
export const splitKey = key => String(key ?? '').split('+').map(k => k.trim()).filter(Boolean);

/* One map id in the schema's form: <prefix>:<ref>. block refs are symbols,
   family refs are numbers. Returns a reason when it is not. */
export function atomProblem(atom, schema) {
  const m = String(atom).match(/^([a-z]+):(.+)$/);
  if (!m) return `"${atom}" is not in the form prefix:ref`;
  if (!schema.prefixes.includes(m[1])) return `"${m[1]}:" is not a key form SCHEMA.md names (${schema.prefixes.map(p => p + ':').join(', ')})`;
  if (m[1] === 'family' && !/^\d+$/.test(m[2])) return `family ref "${m[2]}" is not a number`;
  if (m[1] === 'block' && !/^[A-Za-z][A-Za-z0-9]*$/.test(m[2])) return `block ref "${m[2]}" is not a symbol`;
  return null;
}
export function keyProblem(key, schema) {
  const parts = splitKey(key);
  if (!parts.length) return 'the key is empty';
  if (parts.length > 2) return 'a key joins at most two blocks';
  for (const p of parts) { const why = atomProblem(p, schema); if (why) return why; }
  if (parts.length === 2 && !parts.every(p => p.startsWith('block:'))) return 'a pair joins two blocks';
  return null;
}

/* ── one record against the schema ───────────────────────────────────────── */
const isStr = v => typeof v === 'string';
const isStrArr = v => Array.isArray(v) && v.every(isStr);
const REAL_DATE = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };

export function validate(rec, fileName, schema) {
  const problems = [], notes = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, problems: ['the file is not a JSON object'], notes };
  const status = rec.status;
  for (const f of schema.fields.values()) {
    const present = rec[f.name] !== undefined;
    if (f.required === 'yes' && !present) problems.push(`required field \`${f.name}\` is missing`);
    if (f.required.startsWith('when decided') && status === 'decided' && !(isStr(rec[f.name]) && rec[f.name].trim())) problems.push(`\`${f.name}\` must be written when the record is decided`);
  }
  for (const k of Object.keys(rec)) if (!schema.fields.has(k)) notes.push(`field \`${k}\` is not in SCHEMA.md`);

  if (rec.id !== undefined) {
    if (!isStr(rec.id) || !/^d\d{3,}$/.test(rec.id)) problems.push(`\`id\` "${rec.id}" is not dNNN`);
    else if (fileName && fileName !== rec.id + '.json') problems.push(`\`id\` ${rec.id} does not match its file ${fileName}`);
  }
  if (rec.subject !== undefined) {
    const s = rec.subject;
    if (!s || typeof s !== 'object') problems.push('`subject` is not an object');
    else {
      if (!schema.subjectTypes.includes(s.type)) problems.push(`\`subject.type\` "${s.type}" is not one of ${schema.subjectTypes.join(', ')}`);
      const why = keyProblem(s.key, schema);
      if (why) problems.push(`\`subject.key\`: ${why}`);
      else {
        const parts = splitKey(s.key);
        if (s.type === 'pair' && parts.length !== 2) problems.push('`subject.type` is pair but the key is not two blocks joined by +');
        if (s.type !== 'pair' && parts.length !== 1) problems.push(`\`subject.type\` is ${s.type} but the key joins two keys`);
        if ((s.type === 'block' || s.type === 'constant') && !parts[0].startsWith('block:')) problems.push(`a ${s.type} key uses block:`);
        if (s.type === 'family' && !parts[0].startsWith('family:')) problems.push('a family key uses family:');
      }
    }
  }
  if (rec.also !== undefined) {
    if (!isStrArr(rec.also)) problems.push('`also` is not a list of keys');
    else for (const k of rec.also) { const why = keyProblem(k, schema); if (why) problems.push(`\`also\` "${k}": ${why}`); }
  }
  if (rec.question !== undefined && !(isStr(rec.question) && rec.question.trim())) problems.push('`question` is empty');
  if (rec.decision !== undefined) {
    if (!isStr(rec.decision)) problems.push('`decision` is not a string');
    else if (status === 'open' && rec.decision !== '') problems.push('`decision` must be an empty string while open');
  }
  if (rec.rationale !== undefined && !isStr(rec.rationale)) problems.push('`rationale` is not a string');
  if (rec.evidence !== undefined && !isStrArr(rec.evidence)) problems.push('`evidence` is not a list of links');
  if (rec.date !== undefined && !(isStr(rec.date) && REAL_DATE(rec.date))) problems.push(`\`date\` "${rec.date}" is not a real YYYY-MM-DD date`);
  if (status !== undefined && !schema.statuses.includes(status)) problems.push(`\`status\` "${status}" is not one of ${schema.statuses.join(', ')}`);
  if (rec.supersedes !== undefined && rec.supersedes !== null && rec.supersedes !== '') {
    if (!isStr(rec.supersedes) || !/^d\d{3,}$/.test(rec.supersedes)) problems.push(`\`supersedes\` "${rec.supersedes}" is not dNNN`);
    else if (rec.supersedes === rec.id) problems.push('a record cannot supersede itself');
  }
  if (rec.consequences !== undefined) {
    const c = rec.consequences;
    if (!c || typeof c !== 'object') problems.push('`consequences` is not an object');
    else {
      if (!isStrArr(c.settles)) problems.push('`consequences.settles` is not a list of keys');
      else {
        for (const k of c.settles) { const why = keyProblem(k, schema); if (why) problems.push(`\`consequences.settles\` "${k}": ${why}`); }
        if (status === 'open' && c.settles.length) problems.push('`consequences.settles` must be empty while open');
      }
      if (!isStrArr(c.agents_may)) problems.push('`consequences.agents_may` is not a list of sentences');
    }
  }
  if (rec.source !== undefined) {
    const s = rec.source;
    if (!s || typeof s !== 'object' || !Number.isInteger(s.issue) || !isStr(s.url)) problems.push('`source` is not { issue: N, url }');
  }
  return { ok: problems.length === 0, problems, notes };
}

/* Cross-record rules: a superseded target must say superseded. */
export function crossCheck(records) {
  const byId = new Map(records.map(r => [r.rec?.id, r]));
  const out = [];
  for (const r of records) {
    const t = r.rec?.supersedes;
    if (!t || !byId.has(t)) continue;
    const target = byId.get(t);
    if (target.rec.status !== 'superseded') out.push({ id: target.rec.id, problem: `${r.rec.id} supersedes it, but its \`status\` is "${target.rec.status}"` });
  }
  return out;
}

/* Every key a record judges, as single map ids. */
export function keysOf(rec) {
  const ks = [...splitKey(rec?.subject?.key), ...(Array.isArray(rec?.also) ? rec.also.flatMap(splitKey) : []), ...(Array.isArray(rec?.consequences?.settles) ? rec.consequences.settles.flatMap(splitKey) : [])];
  return [...new Set(ks)];
}

/* ── the reader's key → map id ───────────────────────────────────────────── */
export function readKey(input, schema) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, why: 'type a key, for example block:Ek, family:511 or line:337722' };
  const parts = raw.split('+').map(s => s.trim()).filter(Boolean).map(p => (/^[A-Za-z][A-Za-z0-9]*$/.test(p) ? 'block:' + p : p));
  const key = parts.join('+');
  const line = /^line:(\d+)$/.exec(key);
  if (line) return { ok: true, key, line: Number(line[1]), parts, lineOnly: true };
  if (/^\d+$/.test(raw)) return { ok: false, why: `"${raw}" is a bare number: write family:${raw} or line:${raw}` };
  const why = keyProblem(key, schema);
  if (why) return { ok: false, why };
  return { ok: true, key, parts };
}

/* ── permission ──────────────────────────────────────────────────────────────
   GRANTS  — a conforming, current, decided record judges the key.
   REFUSES — only open records judge it: a question, so the key is not changed.
   HISTORY — only superseded records: no current permission.
   NO RECORD — nothing judges it: no permission.
   A record that does not conform grants nothing; it is listed, never used. */
export function permission(k, loaded) {
  const supersededIds = new Set(loaded.filter(r => r.v.ok && r.rec.supersedes).map(r => r.rec.supersedes));
  /* a broken record may write a bare symbol; match it too, so it is listed as not counted */
  const norm = ks => ks.map(x => (/^[A-Za-z][A-Za-z0-9]*$/.test(x) ? 'block:' + x : x));
  const hits = loaded.filter(r => { const ks = r.v.ok ? keysOf(r.rec) : norm(keysOf(r.rec)); return k.parts.every(p => ks.includes(p)) || r.rec?.subject?.key === k.key; });
  const bad = hits.filter(r => !r.v.ok);
  const good = hits.filter(r => r.v.ok);
  const current = good.filter(r => r.rec.status !== 'superseded' && !supersededIds.has(r.rec.id));
  const decided = current.filter(r => r.rec.status === 'decided');
  const open = current.filter(r => r.rec.status === 'open');
  const history = good.filter(r => !current.includes(r));
  let verdict = 'NO RECORD';
  if (decided.length) verdict = 'GRANTS';
  else if (open.length) verdict = 'REFUSES';
  else if (history.length) verdict = 'HISTORY';
  const may = (decided.length ? decided : open).flatMap(r => r.rec.consequences.agents_may.map(s => ({ id: r.rec.id, s })));
  return { verdict, decided, open, history, bad, may };
}

/* ── the board ─────────────────────────────────────────────────────────────
   19 x 19 intersections. Stones sit on every fourth point (1, 5, 9, 13, 17),
   five by five: 25 stones a board. Record dN goes to board floor((N-1)/25),
   slot (N-1) mod 25, row-major from the top left. Three free lines separate
   stones, so every stone owns its eight neighbours for the keys it judges. */
export const SIZE = 19, STEP = 4, OFFSET = 1, PER_ROW = 5, PER_BOARD = PER_ROW * PER_ROW;
export const numberOf = id => Number(String(id).slice(1));
export const boardOf = n => Math.floor((n - 1) / PER_BOARD);
export function stonePoint(n) { const s = (n - 1) % PER_BOARD; return [OFFSET + (s % PER_ROW) * STEP, OFFSET + Math.floor(s / PER_ROW) * STEP]; }

const RINGS = (() => {
  const out = [];
  for (let r = 1; r < SIZE; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([dx, dy]);
    /* a fixed order: below, right, above, left, then the diagonals, then outward */
    const pref = ['0,1', '1,0', '0,-1', '-1,0', '1,1', '1,-1', '-1,1', '-1,-1'];
    const rank = d => { const i = pref.indexOf(d.join(',')); return i < 0 ? 99 : i; };
    ring.sort((a, b) => rank(a) - rank(b) || (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || Math.atan2(a[0], -a[1]) - Math.atan2(b[0], -b[1]));
    out.push(ring);
  }
  return out;
})();

/* recs: conforming-or-not records on one board, sorted by number.
   Returns stones [{id,n,x,y}] and keys [{key,x,y,by:[ids]}]. A key judged by
   two records sits by the lower-numbered one. */
export function layoutBoard(recs) {
  const taken = new Set();
  for (let y = OFFSET; y < SIZE; y += STEP) for (let x = OFFSET; x < SIZE; x += STEP) taken.add(x + ',' + y);
  const stones = [], keys = new Map();
  for (const r of [...recs].sort((a, b) => numberOf(a.rec.id) - numberOf(b.rec.id))) {
    const n = numberOf(r.rec.id);
    const [x, y] = stonePoint(n);
    stones.push({ id: r.rec.id, n, x, y, r });
    for (const key of keysOf(r.rec)) {
      if (keys.has(key)) { keys.get(key).by.push(r.rec.id); continue; }
      let spot = null;
      for (const ring of RINGS) {
        for (const [dx, dy] of ring) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= SIZE || Y >= SIZE || taken.has(X + ',' + Y)) continue;
          spot = [X, Y]; break;
        }
        if (spot) break;
      }
      if (!spot) continue;
      taken.add(spot.join(','));
      keys.set(key, { key, x: spot[0], y: spot[1], by: [r.rec.id] });
    }
  }
  return { stones, keys: [...keys.values()] };
}
