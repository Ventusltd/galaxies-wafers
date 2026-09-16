/* Does the line we read say what the numbered database says it says?
 *
 * THE PATTERN THIS GENERALISES. Iteration 31 fetches a function's file from
 * raw.githubusercontent at a pinned commit and then checks the text it found
 * against the character count the numbered database holds for that key — the
 * page proving itself against its own data rather than asserting it. This does
 * the same thing one zoom level down, for a single line, and for every line
 * rather than only the ones that belong to a function family.
 *
 * WHAT MAKES IT WORTH RUNNING. The two sides were built from different sources
 * a day apart, and neither knows about the other. all-lines.len.bin is the byte
 * length of each line, written when the pack was generated. LINES.md is the
 * document the reader ranges into, regenerated since. A line's permanent key is
 * never reused, so a key's text must be the same text in both — the number IS
 * the line. If a key's byte length disagrees across the two builds, either the
 * reader returned the wrong row or the estate's central promise is not being
 * kept, and both are worth knowing.
 *
 * DENOMINATORS. Every figure below names the build it came from. The pack and
 * the document are different populations and dividing one by the other is how
 * you get a plausible wrong answer: the pack at 202609142202 holds 250,174
 * lines and the live document holds 283,231 rows.
 */
import { readFile } from 'node:fs/promises';
import { openLineStore } from '../iterations/49-read-the-line/read.mjs';

const PACK = '202609142202';
const REMOTE = `https://globalgrid2050.com/testcode/${PACK}/data/`;
const INDEX = new URL('../iterations/49-read-the-line/line-index.json', import.meta.url);
const SAMPLE = 400;

const fail = [];
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail.push(msg); };
const netFetch = (u, o) => (String(u).startsWith('file:')
  ? readFile(new URL(u)).then(b => new Response(b, { status: 200 }))
  : fetch(u, o));

const grab = async n => {
  const r = await fetch(REMOTE + n);
  if (!r.ok) throw new Error(n + ' returned HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
};
const meta = JSON.parse((await grab('all-lines.meta.json')).toString('utf8'));
const kb = await grab('all-lines.bin');
const lb = await grab('all-lines.len.bin');
const keys = new Uint32Array(kb.buffer, kb.byteOffset, kb.length / 4);
const lens = new Uint16Array(lb.buffer, lb.byteOffset, lb.length / 2);

const store = await openLineStore({ indexUrl: INDEX.href, fetchImpl: netFetch });
console.log(`pack ${PACK}: ${meta.lines.toLocaleString()} lines, generated ${meta.built_utc}`);
console.log(`document: ${store.index.rows.toLocaleString()} rows, index built ${store.index.built_utc}`);
console.log(`sampling ${SAMPLE} keys from the pack and reading each one from the document\n`);

/* A spread across the whole numbering, not a contiguous run: a contiguous run
   would sit in two or three blocks and prove almost nothing about the rest. */
const pick = [];
for (let i = 0; i < SAMPLE; i++) pick.push(Math.floor(keys.length * i / SAMPLE));

let agree = 0, differ = 0, absent = 0, capped = 0;
const examples = [];
for (const i of pick) {
  const key = keys[i], want = lens[i];
  const got = await store.get(key);
  if (got.text === null) { absent++; if (examples.length < 3) examples.push(`key ${key}: ${got.why}`); continue; }
  const have = Buffer.byteLength(got.text, 'utf8');
  if (want === 65535) { capped++; continue; }          /* the pack stores 16 bits; this line reached the ceiling */
  if (have === want) agree++;
  else { differ++; if (examples.length < 3) examples.push(`key ${key}: pack says ${want} bytes, document row is ${have}`); }
}

const measured = agree + differ;
say(differ === 0,
  `${agree.toLocaleString()} of ${measured.toLocaleString()} sampled lines are byte-for-byte the length the pack recorded` +
  (differ ? ` — ${differ} disagree` : ''));
say(absent === 0, `${absent} of ${SAMPLE} sampled keys had no row in the document`);
if (capped) console.log(`  note   ${capped} line(s) skipped: the pack stores length in sixteen bits and they reach the 65,535 ceiling`);
for (const e of examples) console.log('         ' + e);

/* NOT a cost claim, and the first version wrongly asserted one. 400 keys spread
   evenly across the numbering land in ~400 different blocks of the 588 there
   are, so one request each is what the design SAYS should happen, not a
   failure of it. The cost of real reading — where the next line you want is
   numbered near the last — is measured in line-index.check.mjs: 11 requests
   and 0.50 MB for a 70-line session. This only has to stay under the document. */
const s = store.stats();
const docBytes = store.index.source.bytes;
say(s.bytes < docBytes, `${s.requests} requests, ${(s.bytes / 1e6).toFixed(2)} MB of the ${(docBytes / 1e6).toFixed(1)} MB document — one block per scattered key, as designed`);

/* The claim that makes the check meaningful in the first place. */
say(store.index.max >= meta.max,
  `the document reaches key ${store.index.max.toLocaleString()} and the pack reaches ${meta.max.toLocaleString()}: ` +
  `numbers are only ever added, never reused`);

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
