/* Same Name, Same Body? — the arithmetic, in a Web Worker so the page stays live.
 *
 * Input: the text of families.json and the bytes of lines.bin, exactly as the
 * wafer loads them. A family's body is its ordered line-key sequence,
 * lines[lineOffset : lineOffset + lineCount]. Line keys are permanent and one key
 * means one distinct line text, so two identical key sequences are two identical
 * texts in the same order.
 *
 * SAME NAME: group families by their recorded name.
 * SAME BODY: bucket families by a hash of the key sequence, then confirm every
 * bucket member by exact comparison of the key arrays. A hash is never trusted
 * on its own: a collision is counted and shown, not merged.
 *
 * Classic worker (no imports) so every browser that runs the page runs this.
 */
'use strict';

const ANON = '(anonymous)';

function fnv(lines, o, c) {
  let h = 0x811c9dc5 ^ c;
  for (let i = o; i < o + c; i++) {
    const k = lines[i];
    h ^= k & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (k >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (k >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= k >>> 24; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sameSeq(lines, o1, o2, c) {
  for (let i = 0; i < c; i++) if (lines[o1 + i] !== lines[o2 + i]) return false;
  return true;
}

/* compressed sparse rows from a group id per item */
function csr(groupOf, groups) {
  const start = new Int32Array(groups + 1);
  for (let i = 0; i < groupOf.length; i++) start[groupOf[i] + 1]++;
  for (let g = 0; g < groups; g++) start[g + 1] += start[g];
  const fill = start.slice(0, groups), list = new Int32Array(groupOf.length);
  for (let i = 0; i < groupOf.length; i++) list[fill[groupOf[i]]++] = i;
  return { start, list };
}

function intern(values) {
  const table = [], id = new Map(), out = new Int32Array(values.length);
  values.forEach((v, i) => {
    const key = v === null || v === undefined ? '\u0000null' : String(v);
    let x = id.get(key);
    if (x === undefined) { x = table.length; id.set(key, x); table.push(v ?? null); }
    out[i] = x;
  });
  return { table, out };
}

/* Spearman rank correlation, average ranks for ties */
function ranks(a) {
  const idx = Array.from(a.keys()).sort((i, j) => a[i] - a[j]);
  const r = new Float64Array(a.length);
  for (let s = 0; s < idx.length;) {
    let e = s; while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[s]]) e++;
    const avg = (s + e) / 2 + 1;
    for (let t = s; t <= e; t++) r[idx[t]] = avg;
    s = e + 1;
  }
  return r;
}
function spearman(x, y) {
  if (x.length < 3) return null;
  const rx = ranks(x), ry = ranks(y), n = x.length;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += rx[i]; my += ry[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

self.onmessage = e => {
  const { text, buffer } = e.data;
  const t0 = performance.now();
  const post = (phase, done, total) => self.postMessage({ type: 'progress', phase, done, total });
  try {
    post('parsing families.json', 0, 1);
    const fam = JSON.parse(text);
    const lines = new Uint32Array(buffer);
    const F = fam.length;
    if (!Array.isArray(fam) || !F) throw new Error('families.json holds no families');
    const tParsed = performance.now();

    const off = new Int32Array(F), cnt = new Int32Array(F), n = new Int32Array(F);
    const files = new Int32Array(F), repos = new Int32Array(F);
    let beyond = 0;
    for (let f = 0; f < F; f++) {
      off[f] = fam[f].lineOffset; cnt[f] = fam[f].lineCount; n[f] = fam[f].n;
      files[f] = typeof fam[f].files === 'number' ? fam[f].files : -1;
      repos[f] = typeof fam[f].repos === 'number' ? fam[f].repos : -1;
      if (off[f] < 0 || off[f] + cnt[f] > lines.length) beyond++;
    }
    if (beyond) throw new Error(`${beyond} families point past the end of lines.bin`);

    /* SAME BODY: hash to bucket, exact compare to confirm */
    const buckets = new Map();          /* hash -> body ids */
    const rep = [];                     /* body id -> representative family */
    const bodyOf = new Int32Array(F);
    let compares = 0, collisions = 0;
    for (let f = 0; f < F; f++) {
      const h = fnv(lines, off[f], cnt[f]);
      let cand = buckets.get(h), body = -1;
      if (cand) {
        for (const b of cand) {
          const r = rep[b];
          compares++;
          if (cnt[r] === cnt[f] && sameSeq(lines, off[r], off[f], cnt[f])) { body = b; break; }
        }
        if (body < 0) collisions++;
      } else { cand = []; buckets.set(h, cand); }
      if (body < 0) { body = rep.length; rep.push(f); cand.push(body); }
      bodyOf[f] = body;
      if ((f & 511) === 0) post('comparing key sequences', f, F);
    }
    const B = rep.length;
    const byBody = csr(bodyOf, B);
    const tBodies = performance.now();

    /* SAME NAME */
    post('grouping by name', 0, 1);
    const nm = intern(fam.map(x => x.name));
    const nameOf = nm.out, names = nm.table, N = names.length;
    const byName = csr(nameOf, N);
    const kinds = intern(fam.map(x => x.kind)), blocks = intern(fam.map(x => x.block)), cats = intern(fam.map(x => x.category));
    const noName = new Uint8Array(N);
    names.forEach((s, i) => { noName[i] = s === null || s === ANON ? 1 : 0; });

    /* distinct bodies per name (bodies in first-seen order) */
    const nameBodies = new Int32Array(N);
    const seen = new Int32Array(B).fill(-1);
    for (let g = 0; g < N; g++) {
      for (let i = byName.start[g]; i < byName.start[g + 1]; i++) {
        const b = bodyOf[byName.list[i]];
        if (seen[b] !== g) { seen[b] = g; nameBodies[g]++; }
      }
    }

    /* four cases per family, exclusive, in this order of precedence:
       0 same name same body · 1 different names same body · 2 same name different bodies · 3 unique
       4 no name recorded (the placeholder "(anonymous)" is not a name, so it cannot share one) */
    const cas = new Uint8Array(F);
    const counts = [0, 0, 0, 0, 0];
    for (let f = 0; f < F; f++) {
      const b = bodyOf[f], g = nameOf[f];
      let sameName = 0, diffName = 0;
      for (let i = byBody.start[b]; i < byBody.start[b + 1]; i++) {
        const o = byBody.list[i]; if (o === f) continue;
        if (!noName[g] && nameOf[o] === g) sameName++; else diffName++;
      }
      let c;
      if (noName[g] && sameName + diffName === 0) c = 4;
      else if (sameName) c = 0;
      else if (diffName) c = 1;
      else if (nameBodies[g] > 1) c = 2;
      else c = 3;
      cas[f] = c; counts[c]++;
    }
    const nameCase = new Int32Array(N * 5);
    for (let f = 0; f < F; f++) nameCase[nameOf[f] * 5 + cas[f]]++;

    /* rankings */
    const bodyFamilies = new Int32Array(B), bodyFiles = new Int32Array(B), bodyNames = new Int32Array(B);
    for (let b = 0; b < B; b++) {
      bodyFamilies[b] = byBody.start[b + 1] - byBody.start[b];
      const s = new Set(); let fl = 0;
      for (let i = byBody.start[b]; i < byBody.start[b + 1]; i++) { const f = byBody.list[i]; s.add(nameOf[f]); fl += Math.max(0, files[f]); }
      bodyNames[b] = s.size; bodyFiles[b] = fl;
    }
    const TOP = 40;
    const topBodies = Array.from({ length: B }, (_, b) => b)
      .sort((a, b) => bodyFamilies[b] - bodyFamilies[a] || bodyFiles[b] - bodyFiles[a] || n[rep[a]] - n[rep[b]])
      .slice(0, TOP);
    const nameFiles = new Int32Array(N), nameMaxFiles = new Int32Array(N), nameMaxBody = new Int32Array(N).fill(-1);
    for (let g = 0; g < N; g++) {
      for (let i = byName.start[g]; i < byName.start[g + 1]; i++) {
        const f = byName.list[i], fl = Math.max(0, files[f]);
        nameFiles[g] += fl;
        if (fl > nameMaxFiles[g]) { nameMaxFiles[g] = fl; nameMaxBody[g] = bodyOf[f]; }
      }
    }
    const named = Array.from({ length: N }, (_, g) => g).filter(g => !noName[g]);
    const byOverload = named.slice().sort((a, b) => nameBodies[b] - nameBodies[a] || nameFiles[b] - nameFiles[a] || (names[a] < names[b] ? -1 : 1));
    const topNames = byOverload.slice(0, TOP);
    const anonNames = Array.from({ length: N }, (_, g) => g).filter(g => noName[g]);

    /* THE EARLIER FINDING, checked: does ranking names by how many families carry
       them find the most copied code? Compare with ranking by the largest copy
       count of any one body under that name (the pack's per-body files field). */
    const byFamilies = named.slice().sort((a, b) => (byName.start[b + 1] - byName.start[b]) - (byName.start[a + 1] - byName.start[a]) || (names[a] < names[b] ? -1 : 1));
    const byMaxCopy = named.slice().sort((a, b) => nameMaxFiles[b] - nameMaxFiles[a] || (names[a] < names[b] ? -1 : 1));
    const topFamSet = new Set(byFamilies.slice(0, TOP));
    const overlap = byMaxCopy.slice(0, TOP).filter(g => topFamSet.has(g)).length;
    const multi = named.filter(g => byName.start[g + 1] - byName.start[g] > 1);
    const rho = spearman(multi.map(g => nameBodies[g]), multi.map(g => nameMaxFiles[g]));
    const rhoPerBody = spearman(multi.map(g => nameBodies[g]), multi.map(g => nameFiles[g] / nameBodies[g]));
    let famEqBodies = true;
    for (const g of named) if (nameBodies[g] !== byName.start[g + 1] - byName.start[g]) { famEqBodies = false; break; }
    /* the named group with the most sites per body, among names with more than one body */
    let densest = -1;
    for (const g of multi) if (nameBodies[g] > 1 && (densest < 0 || nameFiles[g] / nameBodies[g] > nameFiles[densest] / nameBodies[densest])) densest = g;
    const sharedBodies = Array.from({ length: B }, (_, b) => b).filter(b => bodyFamilies[b] > 1).length;

    const tEnd = performance.now();
    const msg = {
      type: 'done',
      F, B, N, L: lines.length,
      off, cnt, n, files, repos, bodyOf, nameOf, names, noName,
      kind: kinds.out, kinds: kinds.table, block: blocks.out, blocks: blocks.table, cat: cats.out, cats: cats.table,
      bodyStart: byBody.start, bodyList: byBody.list, nameStart: byName.start, nameList: byName.list,
      nameBodies, nameFiles, nameMaxFiles, nameMaxBody, nameCase, cas, counts,
      bodyFamilies, bodyFiles, bodyNames, rep: Int32Array.from(rep),
      topBodies, topNames, anonNames,
      finding: {
        top: TOP, overlap, rho, rhoPerBody, famEqBodies, multiNames: multi.length, sharedBodies,
        mostBodies: byOverload[0] ?? -1, mostFamilies: byFamilies[0] ?? -1, mostCopied: byMaxCopy[0] ?? -1, densest
      },
      stats: { compares, collisions, buckets: buckets.size },
      ms: { parse: tParsed - t0, bodies: tBodies - tParsed, rest: tEnd - tBodies, total: tEnd - t0 }
    };
    self.postMessage(msg, [off.buffer, cnt.buffer, bodyOf.buffer, nameOf.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};
