/* THE READER'S PROOF — does the published estate reach what it asks for?
 *
 * WHY THIS EXISTS. On the night of 2026-09-16 six checks passed while the thing
 * they described was broken, and they all failed the same way:
 *
 *   particles.check.mjs   6/6 on a surface that drew nothing
 *   journeys.check.mjs    5/5 while the page 404s on the data it validates
 *   nest.check.mjs        6/6 naming five surfaces no reader could open
 *   wafer.check.mjs       passed in one tree, ENOENT in another
 *   an ETag freshness gate passed in node and failed in every browser
 *   the app doors         live code, unpublished data, and a silent catch
 *
 * One cause, not six bugs: EVERY PROOF IN THIS ESTATE RAN WHERE THE CODE LIVES,
 * AND NONE RAN WHERE THE READER STANDS. A tree contains the data, the module and
 * the sibling repository. A site contains only what was published, at the paths
 * the page actually asks for. We were proving the tree and shipping the site.
 *
 * A proof that runs against the tree is a STORED claim about the site, so it can
 * drift — and it drifted six times in one night. A proof that fetches the
 * published URL is DERIVED from what the reader receives, and cannot. Derive the
 * proof from the reader's position exactly as the wafer derives the point from
 * the key.
 *
 * NEVER AGAINST LOCALHOST, and this file enforces that rather than asking. A
 * differently-rooted dev server resolves paths GitHub Pages cannot: the doors
 * bug fetched '../../../_board/journeys.json', which is above the site root and
 * unreachable for every reader, and which a server rooted one level higher would
 * have served happily. A check that passes for a reader who does not exist is
 * worse than no check.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. It proves REACHABILITY: that the page
 * answers, and that everything the page declares it needs also answers. It says
 * nothing about whether the page is correct, draws anything, or tells the truth
 * — the render proof and each surface's own checks do that. Stating this is not
 * modesty; a check that does not name its domain is the defect this file exists
 * because of.
 *
 * THE PART THAT MATTERS MOST. An HTML-only sweep does NOT catch the doors bug,
 * because '../../../_board/journeys.json' is fetched from inside a module, not
 * declared in a <script src>. I ran exactly that sweep earlier and it missed it.
 * So this reads the modules too, and resolves the relative paths they name.
 */

const ALLOWED_ORIGINS = ['https://globalgrid2050.com', 'https://ventusltd.github.io'];

const ok = s => s === 200 || s === 206;

/* A URL a reader could actually be at. Anything else is refused loudly: the
   whole value of this file is that it stands where the reader stands. */
function assertPublished(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`${url}: not https — a reader does not read over ${u.protocol}`);
  if (!ALLOWED_ORIGINS.includes(u.origin)) {
    throw new Error(`${url}: origin ${u.origin} is not a published origin. ` +
      `This proof must never run against localhost or a dev server: one rooted above the site ` +
      `would resolve paths Pages cannot, and the check would pass for a reader who does not exist.`);
  }
  return u.href;
}

/* One byte is enough to learn whether the reader can have the rest. */
async function reach(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return r.status;
  } catch (e) { return 'ERR ' + (e.message || e).slice(0, 40); }
}

/* Relative paths a page declares in markup. */
function refsInHtml(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:|data:|#|mailto:|\/\/)/.test(u));
}

/* Relative paths a MODULE declares. Two shapes carry real fetches in this
   estate, and both are reported with the text they were found in so a human can
   falsify a match without rerunning anything:
     const NAME = '../path/thing.json'      a pinned dependency
     fetch('../path/thing.json')            a direct read
   A literal that is a template fragment, or a path assembled at run time, is not
   found here — so a clean result is not proof that every fetch resolves, only
   that every DECLARED one does. */
function refsInModule(src) {
  const out = new Map();
  /* A path, not merely a string with a dot in it. `const POS_KEY = 'nest.card.v1'`
     is a sessionStorage key and the first version of this file fetched it,
     resolved it against the surface, and reported the 404 as a defect. A literal
     earns a fetch only if it looks like a location: it contains a slash, or it
     ends in an extension this estate actually serves. */
  const LOOKS_LIKE_A_PATH = /\//;
  const SERVED = /\.(json|mjs|js|css|html|md|bin|csv|txt|png|svg|webp|ico)$/i;
  const add = (p, why) => {
    if (out.has(p) || /^(https?:|data:|\/\/)/.test(p)) return;
    if (!LOOKS_LIKE_A_PATH.test(p) && !SERVED.test(p)) return;
    /* A literal ending in '/' is a BASE, concatenated with a filename before it
       is ever fetched — `const DATA = '../202609142202/data/'` then DATA + 'all-lines.bin'.
       Fetching the base itself asks for a directory listing, which Pages does not
       serve, so it returns 404 while every real read succeeds. The first version
       of this file reported thirty such bases as unreachable: all false, and all
       for the reason this proof exists to catch — it checked something the reader
       never asks for and called the answer a defect. Bases are counted and named,
       never failed, because what is appended is not knowable from the text. */
    out.set(p, why);
  };
  for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"\s]+)['"]/g)) add(m[2], `const ${m[1]} = '${m[2]}'`);
  for (const m of src.matchAll(/\bfetch\(\s*['"]([^'"\s]+)['"]/g)) add(m[1], `fetch('${m[1]}')`);
  return out;
}

export async function readersProof({ manifestUrl, mutate = false, onLine = console.log }) {
  assertPublished(manifestUrl);
  /* The manifest lives INSIDE one surface and describes its SIBLINGS, so entries
     resolve against the parent directory, not against the manifest's own. The
     first version of this file resolved them against the manifest's directory
     and reported 122 of 122 pages unreachable — a total failure that was mine,
     not the estate's. It is the same mistake it was written to catch: a claim
     about where the reader stands, made from the wrong position. */
  const base = new URL('../', manifestUrl.replace(/[^/]*$/, '')).href;
  const man = await (await fetch(manifestUrl)).json();

  /* A manifest entry with no `entry` is not a page and must not be fetched as
     one. testcode/202609151500/ holds a single module and no index.html; the
     Nest names it because it is on disk and classifies it `kind: "fragment",
     entry: null` rather than hiding it — classify, don't exclude. The first
     version of this file fell back to `stamp + '/'` whenever `entry` was
     missing, turning that honest classification into a 404 and reporting it as
     a defect. A proof that punishes a manifest for being precise is worse than
     one that never looked. Fragments are counted and named, never fetched. */
  const all = man.list || man.surfaces || [];
  const pageEntries = all.filter(s => s.entry);
  const fragments = all.filter(s => !s.entry);
  const list = pageEntries.map(s => new URL(s.entry, base).href);

  if (mutate) {
    /* Three lies, one per class of check, so each is shown able to fail:
       a page that is not there, and — injected below — a module path that is
       not there. Without these the result is only that nothing happened to be
       broken today. */
    list.push(new URL('209901010000-not-a-surface/', base).href);
  }

  const pageBad = [], depBad = [], modBad = [], bases = new Set();
  let pages = 0, deps = 0, mods = 0;

  const one = async (pageUrl) => {
    const r = await fetch(pageUrl).catch(e => ({ ok: false, status: 'ERR ' + e.message }));
    pages++;
    if (!r.ok) { pageBad.push(`${pageUrl} -> ${r.status}`); return; }
    const html = await r.text();
    for (const ref of refsInHtml(html)) {
      const abs = new URL(ref, pageUrl).href;
      deps++;
      const st = await reach(abs);
      if (!ok(st)) depBad.push(`${pageUrl}  declares ${ref} -> ${st}`);
      /* A module is read for what IT asks for. This is the half an HTML sweep
         misses, and the half the doors bug lived in. */
      if (/\.m?js$/.test(ref) && ok(st)) {
        const src = await (await fetch(abs)).text();
        const found = refsInModule(src);
        if (mutate) found.set('../../../_board/not-published.json', "injected: fetch('../../../_board/not-published.json')");
        for (const [p, why] of found) {
          if (p.endsWith('/')) { bases.add(new URL(p, abs).href); continue; }
          mods++;
          const mAbs = new URL(p, abs).href;
          const ms = await reach(mAbs);
          if (!ok(ms)) modBad.push(`${ref}  ${why}  ->  ${ms}\n        resolves to ${mAbs}`);
        }
      }
    }
  };

  const work = [...list];
  await Promise.all(Array.from({ length: 6 }, async () => { while (work.length) await one(work.shift()); }));

  /* WHICH BUILD IS THE READER ACTUALLY READING?
   *
   * vikra-91's objection, and it is correct: a proof that fetches published URLs
   * reports failures it cannot attribute. Pages deploys one commit at a time and
   * cancels the in-flight run when a newer push lands, so with three seats
   * pushing every few minutes the live site can be several commits behind main.
   * Three of the last eight runs were cancelled that way. A 404 then means "not
   * yet", not "broken", and from the outside those look identical.
   *
   * So the proof asks what the site is serving before it judges. When it cannot
   * find out it says so and reports the 404s as UNATTRIBUTED rather than quietly
   * calling them defects — the failure mode of the whole night was a check that
   * answered confidently from the wrong position. */
  let served = null, head = null, lag = '';
  try {
    const { execSync } = await import('node:child_process');
    const run = c => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    /* NOT the legacy pages/builds API. This site deploys by workflow, and that
       endpoint answers with the last LEGACY build — for globalgrid2050 that is
       5a457ca8 from 2026-03-21, six months stale, which made the first version
       of this block report the site as "4452 commits behind" with a straight
       face. An implausible number is the only reason I looked. The deployments
       API is the one that knows what a workflow published. */
    served = JSON.parse(run(
      'gh api "repos/Ventusltd/globalgrid2050/deployments?environment=github-pages&per_page=1"'))[0]?.sha;
    head = run('git -C "C:/Users/vikra/Documents/GitHub/globalgrid2050" rev-parse origin/main');
    if (served && head) {
      const behind = served === head ? 0 : Number(run(
        `git -C "C:/Users/vikra/Documents/GitHub/globalgrid2050" rev-list --count ${served}..${head}`) || 0);
      /* A lag nobody could have created is a broken source, not a broken site. */
      if (behind > 50) throw new Error(`implausible lag of ${behind} commits — the served-commit source is wrong, not the site`);
      lag = served === head
        ? `site is serving origin/main (${head.slice(0, 8)}) — a 404 here is a defect, not a wait`
        : `site is serving ${served.slice(0, 8)}, main is ${head.slice(0, 8)}, ${behind} commit(s) ahead — ` +
          `a 404 may be deploy lag rather than a defect`;
    }
  } catch { lag = 'could not learn which commit the site is serving, so 404s below are UNATTRIBUTED: ' +
                 'they may be defects or they may be deploy lag, and this proof cannot tell from outside'; }

  onLine(`manifest   ${manifestUrl}`);
  onLine(`           generated ${man.generated_utc || '(not stated)'}`);
  onLine(`serving    ${lag}`);
  onLine(`manifest   ${all.length} entries: ${pageEntries.length} pages, ${fragments.length} classified as not-a-page and not fetched`);
  onLine(`pages      ${pages - pageBad.length} of ${pages} answer`);
  onLine(`markup     ${deps - depBad.length} of ${deps} declared references answer`);
  onLine(`modules    ${mods - modBad.length} of ${mods} declared module paths answer`);
  onLine();
  onLine('');
  const say = (good, msg) => { onLine((good ? '  PASS  ' : '  FAIL  ') + msg); return good; };
  const a = say(pageBad.length === 0, `every surface the manifest names can be opened by a reader${pageBad.length ? ` — ${pageBad.length} cannot` : ''}`);
  const b = say(depBad.length === 0, `every reference a page declares in its markup answers${depBad.length ? ` — ${depBad.length} do not` : ''}`);
  const c = say(modBad.length === 0, `every path a module declares answers${modBad.length ? ` — ${modBad.length} do not` : ''}`);
  for (const x of [...pageBad, ...depBad, ...modBad].slice(0, 20)) onLine('        ' + x);
  onLine('');
  onLine('  This proves REACHABILITY only: that the page answers and that what it');
  onLine('  declares it needs answers too. It does not prove the page is correct,');
  onLine('  draws anything, or tells the truth. A path assembled at run time is');
  onLine('  not declared and is not seen here.');
  return { ok: a && b && c, pageBad, depBad, modBad, pages, deps, mods };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const mutate = process.argv.includes('--mutate');
  const manifestUrl = process.argv.find(a => a.startsWith('https://')) ||
    'https://globalgrid2050.com/testcode/202609160224/surfaces.json';
  const r = await readersProof({ manifestUrl, mutate });
  if (mutate) console.log('\n  (--mutate: the failures above are the proof these checks can fail)');
  process.exit(mutate ? 0 : (r.ok ? 0 : 1));
}
