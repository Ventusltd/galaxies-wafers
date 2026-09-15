/* engine.check.mjs — the code galaxy's deep-link contract, checked offline.
 * Same discipline as the grid engine's deeplink proof: no socket, no DOM.
 * Run: node proof/engine.check.mjs
 */
import { schema, LIFTED_FROM, IDENTITY_PARAM, PARAMS, RECEIVERS, NOT_COMPUTED,
         buildDeepLink, parseDeepLink } from '../engine/code-galaxy-engine.mjs';

const failures = []; let passed = 0;
const check = (n, c) => { c ? passed++ : failures.push(n); };
const throws = (fn, K) => { try { fn(); return false; } catch (e) { return e instanceof K; } };

check('the contract says what it was lifted from', /ventus-grid-engine/.test(LIFTED_FROM) && /deeplink\.v1$/.test(schema));
check('the identity is the permanent line number, and it is required',
  IDENTITY_PARAM === 'line' && PARAMS.line.required === true && PARAMS.line.type === 'integer');
check('the contract carries no position, and says so', /wafer\.mjs/.test(NOT_COMPUTED.place) && !('latitude' in PARAMS) && !('longitude' in PARAMS));
check('every receiver has an id, a status and a URL', RECEIVERS.every(r => r.id && r.status && /^https:\/\//.test(r.url)));
check('the receivers table is frozen', Object.isFrozen(RECEIVERS) && RECEIVERS.every(Object.isFrozen));

const link = buildDeepLink('galaxies-wafers', { line: 8285, to: 34201, layers: ['engine', 'declared'], zoom: 9 });
check('a full link round-trips exactly',
  (() => { const p = parseDeepLink(link); return p.ok && p.line === 8285 && p.to === 34201
    && p.layers.join(',') === 'engine,declared' && p.zoom === 9 && p.receiver === 'galaxies-wafers'; })());
check('the link carries only permanent identifiers and numbers: no names, no coordinates',
  !/lat|lon|name|%20/.test(link) && /\?line=8285&to=34201&layers=engine,declared&zoom=9$/.test(link));
check('a link to the layerless wafer refuses a layers field rather than emitting one it cannot read',
  throws(() => buildDeepLink('line-wafer-202609151339', { line: 3, layers: ['engine'] }), Error));
check('a link to an unknown receiver throws rather than returning a dead link',
  throws(() => buildDeepLink('atlas-v8', { line: 3 }), Error));
check('a non-integer identity throws at build time',
  throws(() => buildDeepLink('galaxies-wafers', { line: '8285' }), TypeError)
  && throws(() => buildDeepLink('galaxies-wafers', { line: 0 }), TypeError)
  && throws(() => buildDeepLink('galaxies-wafers', { line: 2 ** 53 }), TypeError));
check('zoom outside the wafer\'s range throws', throws(() => buildDeepLink('galaxies-wafers', { line: 3, zoom: 5000 }), RangeError));
check('a layer id with unsafe characters throws', throws(() => buildDeepLink('galaxies-wafers', { line: 3, layers: ['<b>'] }), TypeError));
check('parse never throws: a bad link comes back with ok false and a reason',
  !parseDeepLink('nonsense').ok && /not a URL/.test(parseDeepLink('nonsense').why)
  && !parseDeepLink('https://x/?to=4').ok && /missing line/.test(parseDeepLink('https://x/?to=4').why)
  && !parseDeepLink('https://x/?line=12abc').ok && !parseDeepLink('https://x/?line=1e308').ok);
check('a bad second number keeps the first so the receiver can refuse and still show the line',
  (() => { const p = parseDeepLink('https://x/?line=3&to=banana'); return !p.ok && p.line === 3; })());
check('duplicate layer ids collapse and empty ones drop',
  parseDeepLink('https://x/?line=3&layers=engine,,engine,%20').layers.join(',') === 'engine');

if (failures.length) { console.error('engine proof FAILED (' + failures.length + ' of ' + (failures.length + passed) + '):\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('engine proof PASS — ' + passed + ' checks');
export default { status: 'PASS', checks: passed };
