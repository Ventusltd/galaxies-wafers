/* ledger.mjs — the arithmetic of the Chemistry Ledger. No DOM, no fetch.
   Everything here counts what star-maker's chemistry files contain. */

export const SEP = '\u00b7'; // the middle dot star-maker writes between elements

/* "Si(202609030137)·Sp·Ss(202609072337)·Ug" -> ["Si(202609030137)","Sp",...] */
export function parts(formula) {
  return String(formula).split(SEP).map(s => s.trim()).filter(Boolean);
}

/* "Si(202609030137)" -> { symbol:"Si", stamp:"202609030137" }; "Shell" -> { symbol:"Shell", stamp:null } */
export function splitElement(label) {
  const m = /^([A-Za-z]+)(?:\(([^)]*)\))?$/.exec(label);
  return m ? { symbol: m[1], stamp: m[2] == null ? null : m[2] } : { symbol: label, stamp: null };
}

/* One pass over compounds[]: per element, how many compositions carry it,
   how many of those produced a red / green / amber star, star totals, and
   the decay texts grouped. */
export function countElements(compounds) {
  const map = new Map();
  compounds.forEach((c, idx) => {
    for (const p of new Set(parts(c.formula))) {
      let e = map.get(p);
      if (!e) {
        e = { label: p, ...splitElement(p), compounds: 0, redCompounds: 0, greenCompounds: 0, amberCompounds: 0,
              stars: 0, green: 0, amber: 0, red: 0, decays: new Map(), idx: [], kinds: {} };
        map.set(p, e);
      }
      e.compounds++;
      if (c.red > 0) e.redCompounds++;
      if (c.green > 0 && c.red === 0 && c.amber === 0) e.greenCompounds++;
      if (c.amber > 0) e.amberCompounds++;
      e.stars += c.stars; e.green += c.green; e.amber += c.amber; e.red += c.red;
      e.kinds[c.kind] = (e.kinds[c.kind] || 0) + 1;
      e.idx.push(idx);
      for (const d of c.decays || []) {
        const g = e.decays.get(d.text) || { text: d.text, stars: 0, compounds: 0 };
        g.stars += d.n; g.compounds++;
        e.decays.set(d.text, g);
      }
    }
  });
  return map;
}

/* Rules as CHEMISTRY.md states them in its own section headings. Returns the
   thresholds and the 1-based line numbers, or a reason when not found. */
export function readRules(md) {
  const lines = String(md).split(/\r?\n/);
  const out = { noble: null, radioactive: null };
  lines.forEach((line, i) => {
    let m = /^##\s*Noble elements\s*\((.*never in a red compound,\s*\u2265\s*(\d+)\s*compounds.*)\)/i.exec(line);
    if (m) out.noble = { line: i + 1, text: line.replace(/^##\s*/, ''), minCompounds: Number(m[2]) };
    m = /^##\s*Radioactive elements\s*\((.*red in\s*\u2265\s*(\d+)\s*%\s*of their compounds.*)\)/i.exec(line);
    if (m) out.radioactive = { line: i + 1, text: line.replace(/^##\s*/, ''), minRedShare: Number(m[2]) / 100 };
  });
  return out;
}

export function isNoble(e, rule) { return !!rule && e.redCompounds === 0 && e.compounds >= rule.minCompounds; }
export function isRadioactive(e, rule) { return !!rule && e.compounds > 0 && e.redCompounds / e.compounds >= rule.minRedShare; }

/* Graph edges whose both ends are nodes in graph.json. */
export function drawableEdges(graph) {
  const labels = new Set((graph.nodes || []).map(n => n.label));
  const kept = [], dropped = [];
  for (const e of graph.edges || []) (labels.has(e.from) && labels.has(e.to) ? kept : dropped).push(e);
  return { kept, dropped };
}

/* Compositions carrying one decay text, and the stars counted on it. */
export function decayTotals(compounds, needle) {
  let compositions = 0, stars = 0;
  for (const c of compounds) for (const d of c.decays || []) if (d.text.includes(needle)) { compositions++; stars += d.n; }
  return { compositions, stars };
}

/* Deterministic layout: elements on a ring grouped by symbol then stamp; decay nodes on an inner ring. */
export function layout(nodes) {
  const els = nodes.filter(n => n.type === 'element').slice().sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const others = nodes.filter(n => n.type !== 'element');
  const pos = new Map();
  els.forEach((n, i) => { const t = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, els.length); pos.set(n.label, { x: Math.cos(t), y: Math.sin(t), n }); });
  others.forEach((n, i) => { const t = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, others.length); pos.set(n.label, { x: 0.32 * Math.cos(t), y: 0.32 * Math.sin(t), n }); });
  return pos;
}
