/* actions.mjs — the button row on every card: WAFER, RUN, APP, SPIDER, CODE, TOOLS.
 *
 * Patterns copied from the estate:
 *   GRID button (pipelinenews grid-proximity cartridge): this module is imported
 *     only when a reader first presses a button ("dynamic-import-on-user-open"),
 *     it is additive only, and nothing it may need is fetched until the press
 *     that needs it. The page counts imports and fetches in a visible line.
 *   MAP button (pipelinenews atlasUrlV9_5_1): the hand-off is a deep link built
 *     from the record's permanent identity, opened by the reader as a link.
 *   No dead ends (cvaa vaccine dead-ends-explained): a button that cannot act for
 *     this card is still shown, and pressing it gives a one-line reason and
 *     where to go instead.
 */

export const ACTIONS_CONTRACT = Object.freeze({ generation: '36-assembly-actions-1', additive_only: true, activation: 'dynamic-import-on-user-open; fetch-on-press' });
export const NAMES = ['WAFER', 'RUN', 'APP', 'SPIDER', 'CODE', 'TOOLS'];

const INVENTORY_GRAPH = 'periodic-table';   /* the spider manifest's "Inventory" graph: node ids are block:<Sym> */

/* ctx: { I, D, engineFiles, FIXTURES, NOT_RECORDED, getJSON(url), SPIDER_MANIFEST, LAYERS_URL } */
export async function press(name, t, ctx) {
  const e = t.element, s = t.surface;
  const firstFn = el => el ? el.function_keys.map(k => ctx.I.fn && ctx.I.fn.get(k)).find(Boolean) : null;
  switch (name) {
    case 'WAFER': {
      if (t.type === 'surface') return reason(`${s.key} is a served folder: it holds no numbered lines of its own. Tap one of its elements, then WAFER.`);
      if (t.type === 'function') return internal({ level: 1, family: t.family }, `family:${t.family}'s lines, lit in sequence order on the dark wafer`, `?key=family:${t.family}&level=1`);
      if (!e.function_keys.length) return reason(`${e.key} lists no function key in the register, so no lines can be lit. Try APP or SPIDER.`);
      const fam = +String((firstFn(e) || { key: e.function_keys[0] }).key).split(':')[1];
      return internal({ level: 1, family: fam }, `the first catalogued function of ${e.key}, family:${fam}, on the dark wafer`, `?key=family:${fam}&level=1`);
    }
    case 'RUN': {
      const el = t.type === 'surface' ? null : e;
      if (!el) return reason(`${s.key} is a served folder; only an engine element can run. Tap an element with an engine module.`);
      const eng = ctx.engineFiles(el);
      if (!eng.length) return reason(`no runnable input recorded: ${el.key} records no ventus-grid-engine engine module at the pinned commit. Try CODE to read it instead.`);
      const fx = eng.find(x => ctx.FIXTURES[x.path]);
      if (!fx) return reason(`no runnable input recorded: ${eng.map(x => `${x.path}: ${ctx.NOT_RECORDED[x.path] || 'no fixture held'}`).join('; ')}. Try CODE.`);
      return internal({ level: 4, element: el.key, engineFile: fx.path, run: true }, `${ctx.FIXTURES[fx.path].fn}() from ${fx.path} running in a worker`, `?key=${el.key}&level=4`);
    }
    case 'APP': {
      let href = null, from = '';
      if (t.type === 'surface') { href = s.url; from = `the served folder ${s.key}`; }
      else {
        const el = e;
        if (!el) return reason(`family:${t.family} names a pack block that is not in the register, so no live address is recorded. Try CODE.`);
        const live = el.live || [];
        const page = live.find(u => /\.html?$|\/$/.test(u));
        href = page || (live[0] ? live[0].slice(0, live[0].lastIndexOf('/') + 1) : null);
        from = page ? `the live address the register records for ${el.key}` : href ? `the folder of ${el.key}'s first recorded live address (${live[0]})` : '';
        if (!href) return reason(`${el.key} records no live address in the register, so there is no surface to open. Try SPIDER to see where it sits.`);
      }
      return link(href, `opens ${from}`);
    }
    case 'SPIDER': {
      if (t.type === 'surface') return reason(`${s.key} is not a node of the spider's Inventory graph; its elements are. Tap one, then SPIDER.`);
      if (!e) return reason(`family:${t.family} names a pack block that is not in the register, so no spider node is known.`);
      const man = await ctx.getJSON(ctx.SPIDER_MANIFEST);
      const entry = (man.graphs || []).find(x => x.id === INVENTORY_GRAPH);
      if (!entry) return reason(`the spider manifest lists no ${INVENTORY_GRAPH} graph, so no node can be checked for ${e.key}.`);
      const g = await ctx.getJSON(new URL(entry.path, ctx.SPIDER_MANIFEST).href);
      const node = (g.nodes || []).find(n => n.id === e.key);
      if (!node) return reason(`${e.key} is not a node of the Inventory graph (${(g.nodes || []).length} nodes read); nothing to open at it. Try CODE.`);
      const file = (e.files || [])[0];
      const q = new URLSearchParams({ graph: INVENTORY_GRAPH, key: e.key });
      if (file) { q.set('repo', file.repo); q.set('path', file.path); }
      return link(`../32-spider-and-galaxy/?${q}`, `iteration 32 at the Inventory graph, where node ${e.key} "${node.label}" exists (read from the graph). It reads ?graph=; key, repo and path ride in the link.`);
    }
    case 'CODE': {
      let line = null, which = '';
      if (t.type === 'function') {
        if (!t.firstLine) return reason(`family:${t.family} is not in the catalogue (10 lines or fewer), so its first line is not known until WAFER reads the numbered database. Press WAFER.`);
        line = t.firstLine; which = `family:${t.family}`;
      }
      else if (t.type !== 'surface') {
        const ff = firstFn(e);
        if (ff) { line = +ff.first_line.split(':')[1]; which = ff.key; }
      }
      if (t.type === 'surface') return reason(`${s.key} is a folder address, not a line. Tap one of its elements, then CODE.`);
      if (!line) return reason(`${e.key} has no function in the catalogue (none over 10 lines), so no first line is known here. Try WAFER for its keys.`);
      return link(`../31-code-card-everywhere/?line=${line}`, `iteration 31's code card at line:${line}, the first entry of ${which}'s line sequence`);
    }
    case 'TOOLS': {
      if (t.type === 'surface') return reason(`${s.key} has no layer of its own; module layers are per element. Tap one, then TOOLS.`);
      if (!e) return reason(`family:${t.family} names a pack block that is not in the register, so no module layer is known.`);
      const m = await ctx.getJSON(ctx.LAYERS_URL);
      const id = `module-${e.symbol}`;
      const layer = (m.layers || []).find(l => l.id === id);
      if (!layer) return reason(`layers/manifest.json lists no ${id} layer (${(m.layers || []).length} layers read), so iteration 33 has nothing to draw for ${e.key}. Try SPIDER.`);
      return link(`../33-engines-as-tools/?layer=modules&tool=transmission&key=${encodeURIComponent(e.key)}`, `iteration 33's module routes layer, which includes ${id} (${layer.features} features, read from the manifest)`);
    }
  }
  return reason(`${name} is not a button this page knows.`);
}
const reason = text => ({ kind: 'reason', text });
const link = (href, text) => ({ kind: 'link', href, text });
const internal = (go, text, deep) => ({ kind: 'internal', go, text, deep });
