/* Pure sRGB visibility model. No DOM, geometry keys, network or source changes. */
export const STYLE_VERSION = '1.0.0';
export const GRAPHICS_COMPARATOR = 3;
export const PROJECT_POLICY = Object.freeze({ minimum_stroke_css_px: 2, minimum_point_radius_css_px: 3, casing_band_css_px: 1, source: 'PROJECT POLICY; size values are not WCAG requirements' });
export const SOURCE_BASELINE = Object.freeze({ line_layer_alpha: 0.55, other_layer_alpha: 0.8, line_width_css_px: 1, point_shape: 'square', point_width_css_px: 2, point_height_css_px: 2, casing: null, zoom_changes_css_size: false, zoom_changes_alpha: false });
export const W3C_REFERENCE = 'https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html';

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}
function unit(value, label) {
  finite(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1`);
  return value;
}
export function rgb(value) {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError('colour must be #rrggbb or three sRGB channels');
  return value.map(channel => unit(channel, 'sRGB channel'));
}
export function hex(value) { return '#' + rgb(value).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join(''); }
export function composite(foreground, alpha, background) {
  const f = rgb(foreground), b = rgb(background); unit(alpha, 'alpha');
  return f.map((c, i) => c * alpha + b[i] * (1 - alpha));
}
export function linearChannel(value) { unit(value, 'sRGB channel'); return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }
export function luminance(value) { const c = rgb(value).map(linearChannel); return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function brightness(value, factor = 1) {
  finite(factor, 'brightness'); if (factor < 0) throw new RangeError('brightness must be nonnegative');
  return rgb(value).map(c => Math.min(1, c * factor));
}
export function sourceContexts({ ground = [0.043, 0.051, 0.071] } = {}) {
  const g = rgb(ground);
  return [
    { id: 'webgl_ground', label: 'WebGL bare ground', rgb: g, source: 'app.mjs clearColor(0.043,0.051,0.071,1); configurable scenario ground' },
    { id: 'carried_centre', label: 'Carried-family point opaque centre', rgb: [0.84, 0.87, 0.94], source: 'app.mjs shader carried vec3; opaque centre only' },
    { id: 'alone_centre', label: 'Uncarried point centre over WebGL ground', rgb: composite([0.30, 0.34, 0.44], 0.30, g), source: 'app.mjs shader alone vec3 at alpha 0.30; edge attenuation excluded' },
    { id: 'fallback_ground', label: 'Canvas fallback bare ground', rgb: rgb('#0b0d12'), source: 'app.mjs fallback fill #0b0d12' },
    { id: 'fallback_point', label: 'Canvas fallback opaque point', rgb: rgb('#7d8598'), source: 'app.mjs fallback point fill #7d8598' }
  ];
}
function contextsChecked(contexts) {
  if (!Array.isArray(contexts) || !contexts.length) throw new TypeError('at least one explicit comparison context is required');
  const ids = new Set();
  return contexts.map(c => {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id)) throw new TypeError('context ids must be unique nonempty strings');
    ids.add(c.id); return { ...c, rgb: rgb(c.rgb) };
  });
}
export function chooseCasing(contexts, { alpha = 1, threshold = GRAPHICS_COMPARATOR } = {}) {
  const checked = contextsChecked(contexts); unit(alpha, 'casing alpha');
  finite(threshold, 'contrast threshold'); if (threshold < 1) throw new RangeError('contrast threshold must be at least 1');
  const candidates = ['#ffffff', '#000000'].map(colour => {
    const ratios = checked.map(c => ({ context_id: c.id, ratio: contrast(composite(colour, alpha, c.rgb), c.rgb) }));
    return { colour, alpha, ratios, minimum_ratio: Math.min(...ratios.map(r => r.ratio)), meets_all: ratios.every(r => r.ratio >= threshold) };
  });
  candidates.sort((a, b) => b.minimum_ratio - a.minimum_ratio || a.colour.localeCompare(b.colour));
  return { ...candidates[0], status: candidates[0].meets_all ? 'MEETS_SELECTED_CONTEXTS' : 'SELECTED_CONTEXTS_LIMIT', candidates };
}
export function currentStyle(layer) {
  rgb(layer.colour);
  return { base_colour: layer.colour, alpha: layer.draws === 'lines' ? 0.55 : 0.8, brightness: 1, line_width_css_px: 1, point_shape: 'square', point_width_css_px: 2, point_height_css_px: 2, casing: null };
}
export function proposedStyle(layer, options = {}) {
  const base = rgb(layer.colour), contexts = contextsChecked(options.contexts ?? sourceContexts());
  const zoom = options.zoom ?? 1; finite(zoom, 'zoom'); if (zoom <= 0) throw new RangeError('zoom must be positive');
  const alpha = unit(options.alpha ?? 1, 'core alpha'), factor = options.brightness ?? 1;
  const lineWidth = Math.max(PROJECT_POLICY.minimum_stroke_css_px, finite(options.strokeCssPx ?? 2, 'stroke size'));
  const radius = Math.max(PROJECT_POLICY.minimum_point_radius_css_px, finite(options.pointRadiusCssPx ?? 3, 'point radius'));
  const mode = options.casing ?? 'auto';
  if (!['auto', 'none', 'light', 'dark'].includes(mode)) throw new TypeError('casing must be auto, none, light or dark');
  const chosenIds = options.casingContextIds ?? ['webgl_ground'];
  if (!Array.isArray(chosenIds) || !chosenIds.length || new Set(chosenIds).size !== chosenIds.length || chosenIds.some(id => !contexts.some(c => c.id === id))) throw new TypeError('casing contexts must name available unique contexts');
  const selected = contexts.filter(c => chosenIds.includes(c.id));
  const choice = chooseCasing(selected, { alpha: options.casingAlpha ?? 1 });
  let casing = null;
  if (mode !== 'none') {
    const colour = mode === 'auto' ? choice.colour : mode === 'light' ? '#ffffff' : '#000000';
    const selectedChoice = choice.candidates.find(candidate => candidate.colour === colour);
    casing = { mode, colour, alpha: unit(options.casingAlpha ?? 1, 'casing alpha'), band_css_px: PROJECT_POLICY.casing_band_css_px, line_width_css_px: lineWidth + 2 * PROJECT_POLICY.casing_band_css_px, point_radius_css_px: radius + PROJECT_POLICY.casing_band_css_px, selection_context_ids: chosenIds.slice(), selection: { ...selectedChoice, status: selectedChoice.meets_all ? 'MEETS_SELECTED_CONTEXTS' : 'SELECTED_CONTEXTS_LIMIT', candidates: choice.candidates } };
  }
  return { base_colour: layer.colour, render_rgb: brightness(base, factor), alpha, brightness: factor, line_width_css_px: lineWidth, point_shape: 'circle', point_radius_css_px: radius, casing, zoom, zoom_changes_css_size: false, zoom_changes_alpha: false, policy: PROJECT_POLICY.source };
}
export function measureStyle(style, contexts) {
  return contextsChecked(contexts).map(c => {
    const outer = style.casing ? composite(style.casing.colour, style.casing.alpha, c.rgb) : c.rgb;
    const core = composite(style.render_rgb ?? brightness(style.base_colour, style.brightness ?? 1), style.alpha, outer);
    const boundary = style.casing ? contrast(outer, c.rgb) : contrast(core, c.rgb);
    return { context_id: c.id, context_rgb: c.rgb, context_display_hex: hex(c.rgb), core_composite_rgb: core, core_display_hex: hex(core), core_to_context_ratio: contrast(core, c.rgb), core_to_casing_ratio: style.casing ? contrast(core, outer) : null, casing_to_context_ratio: style.casing ? contrast(outer, c.rgb) : null, boundary_ratio: boundary, meets_graphics_comparator: boundary >= GRAPHICS_COMPARATOR };
  });
}
export function exportVisibility(manifest, options = {}) {
  if (manifest?.substrate !== 'wafer.v1' || !Array.isArray(manifest.layers)) throw new TypeError('a wafer.v1 manifest is required');
  const contexts = contextsChecked(options.contexts ?? sourceContexts({ ground: options.ground }));
  const ids = new Set();
  const rows = manifest.layers.map((layer, index) => {
    if (!layer || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) throw new TypeError('layer identifiers must be unique nonempty strings');
    if (!Number.isSafeInteger(layer.features) || layer.features < 0) throw new TypeError('manifest feature counts must be nonnegative integers');
    ids.add(layer.id); rgb(layer.colour);
    const empty = layer.features === 0, current = currentStyle(layer), proposed = proposedStyle(layer, { ...options, contexts });
    return { manifest_index: index, layer_id: layer.id, label: layer.label ?? layer.id, group: layer.group ?? '', manifest_features: layer.features, status: empty ? 'EMPTY' : 'STYLE_MODEL', draws: layer.draws ?? 'unspecified', base_colour: layer.colour, current, proposed, current_measurements: empty ? [] : measureStyle(current, contexts), proposed_measurements: empty ? [] : measureStyle(proposed, contexts), model_limit: empty ? 'EMPTY: no marks are created or evaluated' : 'Full-coverage pixel model for named contexts only; antialiased edges, overlaps and clutter are not evaluated' };
  });
  const nonempty = rows.filter(r => r.status !== 'EMPTY');
  const perContext = contexts.map(c => ({ context_id: c.id, evaluated_layers: nonempty.length, current_meets_3_to_1: nonempty.filter(r => r.current_measurements.find(m => m.context_id === c.id).meets_graphics_comparator).length, proposed_boundary_meets_3_to_1: nonempty.filter(r => r.proposed_measurements.find(m => m.context_id === c.id).meets_graphics_comparator).length }));
  return { schema: 'bond.visibility-style.v1', style_version: STYLE_VERSION, source_baseline: SOURCE_BASELINE, project_policy: PROJECT_POLICY, comparator: { ratio: GRAPHICS_COMPARATOR, reference: W3C_REFERENCE, scope: '3:1 graphical adjacency comparator only; not full WCAG conformance, not a minimum-size standard' }, colour_model: 'Source-over compositing in encoded sRGB; relative luminance is computed from unrounded linearized channels; displayed hex values are rounded only for display', contexts, rows, counts: { manifest_entries: rows.length, empty_layers: rows.length - nonempty.length, evaluated_layers: nonempty.length, manifest_feature_sum: rows.reduce((n, r) => n + r.manifest_features, 0), contexts: perContext }, limits: ['No geometry, keys, wafer law or base palette is changed', 'Manifest feature counts are declared source counts, not re-counted feature arrays', 'Core alpha and brightness are independent explicit controls; zoom changes neither CSS-pixel size nor alpha', 'A single light or dark casing may fail on other adjacent contexts', 'Antialiasing, point overlap, layer stacking, glare, colour perception and visual clutter need browser review'] };
}
