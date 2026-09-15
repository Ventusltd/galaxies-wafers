/* wires.mjs — the arithmetic of Hidden Wires, with no DOM and no fetch.
   Every number the page prints about a failure is computed here from the
   files as served; nothing is typed. The tests import this same file. */

/* A failure message in compounds.json reads "<reporting part>: <text>".
   It names a hidden wire only when the text says "<X> requires the <Y> module"
   (the wording of the throw sites in the cartridges). Any other message names
   no needed part, so no wire is drawn for it. */
const NEED = /^(?:[A-Za-z]*Error: )?([a-z0-9][a-z0-9-]*) requires the ([a-z0-9][a-z0-9-]*) module$/;

export function parseMessage(text) {
  const s = String(text);
  const i = s.indexOf(': ');
  if (i < 0) return { text: s, reporter: null, body: s, failing: null, needed: null };
  const reporter = s.slice(0, i), body = s.slice(i + 2);
  const m = body.match(NEED);
  return { text: s, reporter, body, failing: m ? m[1] : null, needed: m ? m[2] : null };
}

/* Formula "Si(202609030137)·Sp·Ss(202609072337)·Ug" -> {Si:'202609030137', Sp:'', ...}.
   An element with no stamp is the generation the composition was cut from. */
export function tokens(formula) {
  const out = {};
  for (const t of String(formula).split('·')) {
    const m = t.match(/^([A-Za-z]+)(?:\((\d+)\))?$/);
    if (m) out[m[1]] = m[2] || '';
  }
  return out;
}

/* The symbol legend in CHEMISTRY.md: "Symbols: **Sp** streaming-parquet-bridge · **Ug** ..." */
export function legend(markdown) {
  const line = String(markdown).split('\n').find(l => /^Symbols:/.test(l));
  const map = {};
  if (!line) return map;
  for (const m of line.matchAll(/\*\*([A-Za-z]+)\*\*\s+([a-z0-9-]+)/g)) map[m[1]] = m[2];
  return map;
}

/* All the counting, one pass over the compounds. */
export function countFailures(doc) {
  const compounds = Array.isArray(doc && doc.compounds) ? doc.compounds : [];
  const byText = new Map();
  let failed = 0, clean = 0, withWire = 0;
  for (const c of compounds) {
    if ((c.red || 0) + (c.amber || 0) > 0) failed++; else clean++;
    if ((c.decays || []).some(d => parseMessage(d.text).needed)) withWire++;
    for (const d of c.decays || []) {
      let w = byText.get(d.text);
      if (!w) { w = { ...parseMessage(d.text), compositions: 0, stars: 0, kinds: {}, stamps: {} }; byText.set(d.text, w); }
      w.compositions++;
      w.stars += d.n || 0;
      w.kinds[c.kind] = (w.kinds[c.kind] || 0) + 1;
      for (const [s, stamp] of Object.entries(tokens(c.formula))) {
        if (!stamp) continue;
        const r = (w.stamps[s] ||= { min: stamp, max: stamp, set: new Set() });
        if (stamp < r.min) r.min = stamp;
        if (stamp > r.max) r.max = stamp;
        r.set.add(stamp);
      }
    }
  }
  const messages = [...byText.values()].sort((a, b) => b.compositions - a.compositions || (a.text < b.text ? -1 : 1));
  messages.forEach((m, i) => { m.id = 'w' + i; });
  return {
    total: compounds.length, failed, clean, withWire, generated_utc: doc && doc.generated_utc, stars: doc && doc.stars,
    messages,
    wires: messages.filter(m => m.needed),
    unnamed: messages.filter(m => !m.needed)
  };
}

/* Unplug evidence. Among compositions of kind "unplug" that contain the host
   element (the element whose legend name is the reporting part), an element E
   is a supplier by unplug when every such composition lacking E failed with
   the message and none containing E did. */
export function unplugSuppliers(doc, text, hostSymbol, symbols) {
  const un = ((doc && doc.compounds) || []).filter(c => c.kind === 'unplug')
    .map(c => ({ tk: tokens(c.formula), hit: (c.decays || []).some(d => d.text === text) }));
  const withHost = hostSymbol ? un.filter(u => hostSymbol in u.tk) : [];
  const hits = withHost.filter(u => u.hit).length;
  const suppliers = [];
  if (hits) {
    for (const e of symbols) {
      if (e === hostSymbol) continue;
      const lacking = withHost.filter(u => !(e in u.tk)), having = withHost.filter(u => e in u.tk);
      if (lacking.length && lacking.every(u => u.hit) && having.every(u => !u.hit)) suppliers.push({ symbol: e, lacking: lacking.length, having: having.length });
    }
  }
  return { suppliers, unplugs: un.length, withHost: withHost.length, hits };
}

/* graph.json: is there a decay node for this message, and how many elements
   carry a DECAYS_TO edge into it. */
export function decayEdges(graph, text) {
  if (!graph || !Array.isArray(graph.edges)) return null;
  const node = (graph.nodes || []).some(n => n.type === 'decay' && n.label === text);
  const from = new Set();
  for (const e of graph.edges) if (e.kind === 'DECAYS_TO' && e.to === text) from.add(e.from);
  return { node, elements: from.size };
}

/* The register, read as it is now. */
export function registerIndex(reg) {
  const blocks = Array.isArray(reg && reg.blocks) ? reg.blocks : [];
  const bySymbol = new Map(), byTitle = new Map();
  for (const b of blocks) { bySymbol.set(b.symbol, b); if (!byTitle.has(b.title)) byTitle.set(b.title, b); }
  const edges = [];
  for (const b of blocks) for (const d of b.depends_on || []) if (bySymbol.has(d.symbol)) edges.push({ from: b.symbol, to: d.symbol, via: d.via || [] });
  return { blocks, bySymbol, byTitle, edges, generated_utc: reg && reg.generated_utc };
}

export const camel = s => String(s).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/* Does the register now declare that <host> needs <needed>?
   yes when the host block's depends_on names a block titled exactly the needed
   part, or the host block's needs lists the needed part by name (as written,
   or in the camelCase the cartridges use for module keys). */
export function declaredNow(idx, hostTitle, needed) {
  const host = idx.byTitle.get(hostTitle) || null;
  const candidates = idx.blocks.filter(b => String(b.title).toLowerCase().includes(needed.toLowerCase())).map(b => b.symbol);
  if (!host) return { host: null, declared: null, reason: `no register block is titled "${hostTitle}"`, candidates, candidateDeps: [] };
  const target = idx.byTitle.get(needed) || null;
  const dep = (host.depends_on || []).find(d => (target && d.symbol === target.symbol) || d.title === needed);
  const need = (host.needs || []).find(n => n.name === needed || n.name === camel(needed));
  const candidateDeps = (host.depends_on || []).filter(d => candidates.includes(d.symbol)).map(d => d.symbol);
  return {
    host: host.symbol, declared: Boolean(dep || need),
    by: dep ? `depends_on ${dep.symbol}` : need ? `needs "${need.name}"` : null,
    target: target ? target.symbol : null, candidates, candidateDeps,
    depends: (host.depends_on || []).length, needs: (host.needs || []).length
  };
}

/* cvaa vaccine file names that mention either end of a wire. */
export function vaccineMentions(names, wire) {
  const terms = [wire.needed, wire.failing, wire.needed && camel(wire.needed), wire.failing && camel(wire.failing)]
    .filter(Boolean).map(s => s.toLowerCase());
  return names.filter(n => terms.some(t => n.toLowerCase().includes(t)));
}

/* Layout, a pure function of the register order: blocks on a golden-angle
   disc by their position in the register; parts named in failure messages
   that have no register block sit on an outer ring, in name order. */
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export function layout(blocks, extraNames, R = 100) {
  const pos = new Map();
  const n = blocks.length;
  blocks.forEach((b, i) => {
    const r = R * Math.sqrt((i + 0.5) / Math.max(1, n)), t = i * GOLDEN;
    pos.set(b.symbol, [r * Math.cos(t), r * Math.sin(t)]);
  });
  const names = [...new Set(extraNames)].sort();
  names.forEach((name, i) => {
    const t = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / Math.max(1, names.length));
    pos.set('part:' + name, [1.25 * R * Math.cos(t), 1.25 * R * Math.sin(t)]);
  });
  return pos;
}

/* Quadratic curve samples for a wire, bowed to one side so a hidden wire never
   hides under a straight declared line between the same two points. */
export function curve(a, b, bow = 0.22, steps = 24) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bow, cy = my + dx * bow;
  const pts = new Float64Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts[i * 2] = u * u * a[0] + 2 * u * t * cx + t * t * b[0];
    pts[i * 2 + 1] = u * u * a[1] + 2 * u * t * cy + t * t * b[1];
  }
  return pts;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
