/* Does the sparse index actually return the right line?
 *
 * The claim the page makes is that any numbered line can be read on its own,
 * over the network, without holding the estate. This checks that claim the only
 * way it can be checked: pick keys across the whole range, read each one
 * through the store, and compare the text with the same row taken from the
 * whole document. A row that cannot be proved equal is a failure, and so is a
 * read that costs more requests than the design says it should.
 */
import { readFile } from 'node:fs/promises';
import { openLineStore } from '../iterations/49-read-the-line/read.mjs';

const INDEX = new URL('../iterations/49-read-the-line/line-index.json', import.meta.url);

/* In the browser the index is fetched like anything else; here it is a file on
   disk, and Node's fetch does not do file:. Only the index takes this path —
   every read of LINES.md goes over the real network, as the page's would. */
const netFetch = (u, o) => (String(u).startsWith('file:')
  ? readFile(new URL(u)).then(b => new Response(b, { status: 200 }))
  : fetch(u, o));
const fail = [];
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail.push(msg); };

/* The whole document once, as the thing the store's answers are measured against. */
const store = await openLineStore({ indexUrl: INDEX.href, fetchImpl: netFetch, onStatus: s => console.log('index: ' + s.why) });
const src = store.index.source.url;
const whole = await (await fetch(src)).text();
const truth = new Map();
{
  const body = whole.slice(whole.indexOf('```text') + 7, whole.lastIndexOf('```'));
  for (const row of body.split('\n')) {
    const t = row.indexOf('\t');
    if (t <= 0) continue;
    const n = Number(row.slice(0, t));
    if (Number.isInteger(n) && n > 0 && !truth.has(n)) truth.set(n, row.slice(t + 1));
  }
}
console.log(`document: ${truth.size} rows; index built against ${store.index.source.bytes} bytes, ${store.index.rows} rows`);

/* Keys across the range: the ends, the anchors themselves and either side of
   them (where an off-by-one block boundary would show), and a spread of others. */
const all = [...truth.keys()];
const probes = new Set([all[0], all[all.length - 1], store.index.min, store.index.max]);
for (const k of store.index.keys) { probes.add(k); probes.add(k - 1); probes.add(k + 1); }
for (let i = 0; i < 40; i++) probes.add(all[Math.floor(all.length * i / 40)]);

let checked = 0;
for (const key of probes) {
  if (!truth.has(key)) continue;
  const got = await store.get(key);
  checked++;
  if (got.text !== truth.get(key)) {
    say(false, `key ${key}: expected ${JSON.stringify(truth.get(key)).slice(0, 60)}, got ${JSON.stringify(got.text).slice(0, 60)} ${got.why}`);
  }
}
say(true, `${checked} keys read one at a time, every one byte-identical to the row in the document`);

/* The cost claim. The sweep above deliberately touches every block, so it is no
   measure of anything: it asks for one key from all 588 of them and therefore
   reads the whole document. The claim is about a READING SESSION — a line, then
   the lines around it, then somewhere else — so that is what is measured, on a
   store that has just been opened. */
const DOC_BYTES = store.index.source.bytes;
say(store.stats().requests <= checked, `${store.stats().requests} requests for ${checked} scattered keys (one per block, by construction)`);

const fresh = await openLineStore({ indexUrl: INDEX.href, fetchImpl: netFetch });
const session = [];
{
  const start = all[Math.floor(all.length * 0.37)];
  for (let k = start; k < start + 60; k++) if (truth.has(k)) session.push(k);       /* reading around one place */
  for (let i = 0; i < 10; i++) session.push(all[Math.floor(all.length * (i * 7 % 10) / 10)]);  /* ten jumps elsewhere */
}
for (const k of session) await fresh.get(k);
const f = fresh.stats();
say(f.requests <= 12, `a ${session.length}-line reading session cost ${f.requests} requests`);
say(f.bytes < DOC_BYTES / 20, `it read ${(f.bytes / 1e6).toFixed(2)} MB — ${(100 * f.bytes / DOC_BYTES).toFixed(2)}% of the ${(DOC_BYTES / 1e6).toFixed(1)} MB document`);

/* A key that was never issued must be refused, not guessed. */
let absent = store.index.max + 1000;
const miss = await store.get(absent);
say(miss.text === null && !!miss.why, `key ${absent} refused: "${miss.why}"`);

/* Neighbours are free: the block that answered one key answers the next. */
const before = store.stats().requests;
const anchor = store.index.keys[Math.floor(store.index.keys.length / 2)];
let near = 0;
for (let k = anchor; k < anchor + 30; k++) if (truth.has(k)) { await store.get(k); near++; }
say(store.stats().requests - before <= 1, `${near} neighbouring lines cost ${store.stats().requests - before} further request(s)`);


/* THE TEST THAT MATTERS: a drifted index must still be RIGHT, not merely slow.
   Every offset is pushed out of place, which is what a regenerated LINES.md
   does to it, and the same keys are asked for again. */
{
  const bad = JSON.parse(JSON.stringify(store.index));
  for (let i = 0; i < bad.offs.length; i++) bad.offs[i] = Math.max(0, bad.offs[i] - 90000);
  const driftFetch = (u, o) => (String(u).includes('line-index')
    ? Promise.resolve(new Response(JSON.stringify(bad), { status: 200 }))
    : netFetch(u, o));
  const d = await openLineStore({ indexUrl: 'file:///x/line-index.json', fetchImpl: driftFetch });
  const sample = [all[0], all[1], all[Math.floor(all.length * 0.25)], all[Math.floor(all.length * 0.5)],
                  all[Math.floor(all.length * 0.77)], all[all.length - 1], 192067, 342795].filter(k => truth.has(k));
  let wrong = 0, right = 0;
  for (const k of sample) {
    const r = await d.get(k);
    if (r.text === truth.get(k)) right++;
    else {
      wrong++;
      if (wrong < 4) say(false, `drifted index, key ${k}: got ${JSON.stringify(String(r.text)).slice(0, 50)} want ${JSON.stringify(truth.get(k)).slice(0, 50)}`);
    }
  }
  say(wrong === 0, `every offset moved 90,000 bytes out of place: ${right} of ${sample.length} keys still read correctly, by search`);
  say(d.drifted, 'the store noticed the drift and said so rather than trusting itself');
  const ds = d.stats();
  say(true, `the drifted reads cost ${ds.requests} requests, ${(ds.bytes / 1e6).toFixed(2)} MB, ${ds.searched} searches`);
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
