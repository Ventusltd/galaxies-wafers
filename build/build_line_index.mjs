/* The sparse byte index into LINES.md.
 *
 * WHY THIS IS SPARSE. A dense index — one byte offset for every one of the
 * 282,551 numbered lines — is 1.1 MB the page would have to hold before it
 * could show a single line. A sparse one is 8 KB. It records the byte offset of
 * every STRIDE-th issued key, and the page reads the block between two anchors:
 * one Range request, about 45 KB, and every other line in that block comes with
 * it for nothing. Lines near each other in number are what you click next, so
 * the block that answers the first click usually answers the next twenty.
 *
 * WHY IT IS SELF-VERIFYING. LINES.md is regenerated as the estate grows: it was
 * 25,159,714 bytes when the pinned data pack was built and 25,238,570 a day
 * later. Every byte offset in this file is therefore a GUESS about a document
 * that may have moved underneath it. So the page never trusts an offset: it
 * fetches the block, looks for a row that begins `key<TAB>`, and if the key is
 * not in the block it says the index is stale rather than showing the wrong
 * line. See lineStore() in the iteration's read.mjs for the correction walk.
 *
 * Offsets are into the RAW file, counted in bytes, not in string indexes: the
 * code held in these rows is not all ASCII and a character offset would be
 * wrong wherever it is not.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const URL_ = 'https://ventusltd.github.io/stars/LINES.md';
const STRIDE = 512;
/* A block is also cut whenever it reaches this many bytes. Without it one block
   ran to 565 KB: a few numbered lines hold an entire release changelog as one
   row, and a stride counted in rows says nothing about the bytes they cost. */
const MAX_BLOCK = 64 * 1024;
const OUT = new URL('../iterations/49-read-the-line/line-index.json', import.meta.url);

const res = await fetch(URL_);
if (!res.ok) throw new Error(URL_ + ' returned HTTP ' + res.status);
const etag = res.headers.get('etag') || null;
const buf = Buffer.from(await res.arrayBuffer());
const sha256 = createHash('sha256').update(buf).digest('hex');

const TAB = 0x09, NL = 0x0a;
const keys = [], offs = [];
let rows = 0, first = null, last = null, lastOff = 0;

/* Only the fenced block is the database; the prose above it and the fence below
   are not rows. The canonical builder (build_all_lines.mjs) slices between
   ```text and the final ```, and this walks the same span so the two agree on
   which lines exist. */
const FENCE = buf.indexOf(Buffer.from('```text\n'));
if (FENCE < 0) throw new Error('LINES.md has no ```text fence');
const START = FENCE + 8;
const END = buf.lastIndexOf(Buffer.from('```'));

/* Walk the raw bytes once. A row is `number<TAB>code`. */
let i = START, sinceRows = STRIDE, sinceBytes = 0, anchorAt = START;
while (i < END) {
  let end = buf.indexOf(NL, i);
  if (end < 0 || end > END) end = END;
  let j = i, n = 0, digits = 0;
  while (j < end && buf[j] >= 0x30 && buf[j] <= 0x39) { n = n * 10 + (buf[j] - 0x30); j++; digits++; }
  if (digits > 0 && j < end && buf[j] === TAB && n > 0) {
    if (sinceRows >= STRIDE || i - anchorAt >= MAX_BLOCK) {
      keys.push(n); offs.push(i); sinceRows = 0; anchorAt = i;
    }
    if (first === null) first = n;
    last = n; lastOff = i;
    rows++; sinceRows++;
  }
  i = end + 1;
}

/* The last row is an anchor too, so every key falls between two anchors and the
   final block has a known end rather than running to the end of the file. */
if (keys[keys.length - 1] !== last) { keys.push(last); offs.push(lastOff); }
/* One past the last row, so the final block has an end like every other. */
offs.push(Math.min(END, buf.indexOf(NL, lastOff) + 1 || END));

const index = {
  schema: 'line-index.v1',
  source: { url: URL_, bytes: buf.length, sha256, etag },
  built_utc: new Date().toISOString(),
  stride: STRIDE,
  rows,
  min: first,
  max: last,
  anchors: keys.length,
  /* offs is one longer than keys: block k is bytes offs[k]..offs[k+1], so the
     last block has an end like every other one. */
  block_bytes_max: offs.reduce((m, o, k) => k ? Math.max(m, o - offs[k - 1]) : m, 0),
  keys,
  offs
};

writeFileSync(OUT, JSON.stringify(index));
const { keys: _k, offs: _o, ...shown } = index;
console.log(JSON.stringify(shown, null, 1));
console.log('index bytes', JSON.stringify(index).length);
