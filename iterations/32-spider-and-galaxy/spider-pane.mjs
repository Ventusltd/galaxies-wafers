/* spider-pane.mjs — the spider's graph drawn on one canvas, radial as the
 * spider draws it: the focus card in the centre, what it points to on the
 * right, what points to it on the left, every other node of the graph on an
 * outer ring. No DOM node per spider node: one canvas, redrawn on change.
 *
 * Colours: edge colours are the spider's own edge-type palette (index.html
 * --e-data, --e-governance, --e-archive, --e-external, --e-repo, --e-workflow).
 * Node fill is one neutral colour; the spider's rag field is printed as its
 * own status label beside the name, never used as a fill.
 * The ring round a node is the bridge: solid beam blue when the numbered
 * universe holds a counterpart, dashed grey when the node names a repository,
 * path, block or family the universe does not hold, none when it names nothing.
 */
const ECSS = { data: '#00e5ff', governance: '#b47cff', archive: '#7da0c8', external: '#5f76a4', repo: '#b8ccff', workflow: '#00ffff', contains: '#7da0c8' };
const MAX_EDGES = 4000;     /* faint background edges drawn per frame */
const MAX_LABELS = 28;      /* neighbour labels drawn around the focus */

export function createSpider(pane, { onTap }) {
  const cv = document.createElement('canvas');
  cv.className = 'sgraph';
  pane.append(cv);
  const S = { nodes: [], edges: [], focus: 0, bridge: [], highlight: new Map(), pos: null, w: 0, h: 0, dpr: 1 };

  function resize() {
    S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.w = pane.clientWidth; S.h = pane.clientHeight;
    cv.width = Math.max(1, Math.round(S.w * S.dpr)); cv.height = Math.max(1, Math.round(S.h * S.dpr));
    layout(); draw();
  }
  new ResizeObserver(resize).observe(pane);

  function layout() {
    const n = S.nodes.length;
    S.pos = new Float32Array(n * 2);
    if (!n) return;
    const cx = S.w / 2, cy = S.h / 2, m = Math.min(S.w, S.h);
    const R1 = m * 0.28, R2 = m * 0.46;
    const out = [], inc = [], seen = new Set([S.focus]);
    for (const [a, b] of S.edges) {
      if (a === S.focus && !seen.has(b)) { out.push(b); seen.add(b); }
    }
    for (const [a, b] of S.edges) {
      if (b === S.focus && !seen.has(a)) { inc.push(a); seen.add(a); }
    }
    S.out = out; S.inc = inc; S.near = new Set([...out, ...inc]);
    const arc = (list, a0, a1) => list.forEach((idx, k) => {
      const t = list.length === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * k / (list.length - 1);
      S.pos[idx * 2] = cx + R1 * Math.cos(t); S.pos[idx * 2 + 1] = cy + R1 * Math.sin(t);
    });
    arc(out, -1.35, 1.35);                  /* right: what the focus points to */
    arc(inc, Math.PI + 1.35, Math.PI - 1.35); /* left: what points to the focus */
    S.pos[S.focus * 2] = cx; S.pos[S.focus * 2 + 1] = cy;
    const rest = [];
    for (let i = 0; i < n; i++) if (!seen.has(i)) rest.push(i);
    rest.forEach((idx, k) => {
      const t = -Math.PI / 2 + 2 * Math.PI * k / rest.length;
      S.pos[idx * 2] = cx + R2 * Math.cos(t); S.pos[idx * 2 + 1] = cy + R2 * Math.sin(t);
    });
  }

  const clip = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);

  function draw() {
    const c = cv.getContext('2d');
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.w, S.h);
    const n = S.nodes.length;
    if (!n || !S.pos) return;
    const P = i => [S.pos[i * 2], S.pos[i * 2 + 1]];
    /* background edges, faint, capped */
    c.lineWidth = 0.6; c.globalAlpha = 0.09; c.strokeStyle = '#b8ccff';
    c.beginPath();
    let k = 0;
    for (const [a, b] of S.edges) {
      if (a === S.focus || b === S.focus) continue;
      if (++k > MAX_EDGES) break;
      const [x0, y0] = P(a), [x1, y1] = P(b); c.moveTo(x0, y0); c.lineTo(x1, y1);
    }
    c.stroke();
    /* the focus's own edges in the spider's edge colours */
    c.globalAlpha = 0.85; c.lineWidth = 1.2;
    for (const [a, b, t] of S.edges) {
      if (a !== S.focus && b !== S.focus) continue;
      const [x0, y0] = P(a), [x1, y1] = P(b);
      c.strokeStyle = ECSS[t] || ECSS.repo; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    c.globalAlpha = 1;
    /* nodes */
    for (let i = 0; i < n; i++) {
      const [x, y] = P(i);
      const isF = i === S.focus, near = S.near.has(i);
      const r = isF ? 8 : near ? 5 : 2.4;
      const b = S.bridge[i];
      if (b && (isF || near || S.highlight.has(i))) {
        c.lineWidth = 1.4;
        if (b === 'known') { c.setLineDash([]); c.strokeStyle = '#5ec8f2'; }
        else if (b === 'unknown' || b === 'pending') { c.setLineDash([3, 3]); c.strokeStyle = '#8b93a7'; }
        if (b !== 'none') { c.beginPath(); c.arc(x, y, r + 3.5, 0, 6.2832); c.stroke(); }
        c.setLineDash([]);
      } else if (b === 'known') {
        c.fillStyle = '#5ec8f2'; c.globalAlpha = 0.55; c.beginPath(); c.arc(x, y, r + 1.4, 0, 6.2832); c.fill(); c.globalAlpha = 1;
      }
      c.fillStyle = isF ? '#eef2fb' : near ? '#b8ccff' : '#6d7890';
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
      if (S.highlight.has(i)) { c.strokeStyle = '#ffd54a'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 7, 0, 6.2832); c.stroke(); }
    }
    /* labels: focus, neighbours up to the cap, highlighted nodes */
    c.font = '11px ui-monospace,Menlo,Consolas,monospace'; c.textBaseline = 'middle';
    const label = (i, bright) => {
      const nd = S.nodes[i], [x, y] = P(i);
      const right = x >= S.w / 2 - 1;
      const text = clip(nd.label, S.w < 520 ? 15 : 22), tag = ' · ' + nd.rag;
      c.textAlign = right ? 'left' : 'right';
      const dx = right ? 10 : -10;
      c.fillStyle = '#0b0d12'; c.globalAlpha = 0.75;
      const wT = c.measureText(text + tag).width;
      c.fillRect(right ? x + dx - 2 : x + dx - wT - 2, y - 7, wT + 4, 14); c.globalAlpha = 1;
      if (right) {
        c.fillStyle = bright ? '#eef2fb' : '#c6cedd'; c.fillText(text, x + dx, y);
        c.fillStyle = '#8b93a7'; c.fillText(tag, x + dx + c.measureText(text).width, y);
      } else {
        c.fillStyle = '#8b93a7'; c.fillText(tag, x + dx, y);
        c.fillStyle = bright ? '#eef2fb' : '#c6cedd'; c.fillText(text, x + dx - c.measureText(tag).width, y);
      }
    };
    let shown = 0;
    for (const i of S.near) { if (shown++ >= MAX_LABELS) break; label(i, false); }
    for (const i of S.highlight.keys()) label(i, true);
    /* the focus label sits under its node, centred */
    { const nd = S.nodes[S.focus], [x, y] = P(S.focus); c.textAlign = 'center'; c.fillStyle = '#eef2fb';
      c.font = '12px ui-monospace,Menlo,Consolas,monospace'; c.fillText(clip(nd.label, 34), x, y + 20);
      c.fillStyle = '#8b93a7'; c.font = '10.5px ui-monospace,Menlo,Consolas,monospace';
      c.fillText('status label: ' + nd.rag, x, y + 34); }
    if (S.near.size > MAX_LABELS) {
      c.textAlign = 'left'; c.fillStyle = '#8b93a7'; c.font = '10.5px ui-monospace,Menlo,Consolas,monospace';
      c.fillText(`${MAX_LABELS} of ${S.near.size} neighbour labels drawn`, 8, S.h - 10);
    }
  }

  function pick(cx, cy, reach = 22) {
    let best = -1, bestD = reach * reach;
    for (let i = 0; i < S.nodes.length; i++) {
      const dx = S.pos[i * 2] - cx, dy = S.pos[i * 2 + 1] - cy, d = dx * dx + dy * dy;
      /* the focus and its neighbours win ties against the dense outer ring */
      const bias = (i === S.focus || S.near.has(i)) ? 0.6 : 1;
      if (d * bias < bestD) { bestD = d * bias; best = i; }
    }
    return best;
  }

  let down = null;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]); down = null;
    if (moved > 8) return;
    const b = cv.getBoundingClientRect();
    const i = pick(e.clientX - b.left, e.clientY - b.top);
    if (i >= 0) onTap?.(i);
  });

  return {
    setGraph(g, bridge) { S.nodes = g.nodes; S.edges = g.edges; S.focus = 0; S.bridge = bridge || []; S.highlight = new Map(); resize(); },
    setBridge(bridge) { S.bridge = bridge; draw(); },
    focus(i) { S.focus = i; S.highlight = new Map(); layout(); draw(); },
    highlight(list) { S.highlight = new Map(list); draw(); },
    screenOf(i) { const b = cv.getBoundingClientRect(); return [b.left + S.pos[i * 2], b.top + S.pos[i * 2 + 1]]; },
    get state() { return S; }
  };
}
