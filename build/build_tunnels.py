#!/usr/bin/env python3
"""Tunnels: a shared line is two far regions of the numbering that are the same text.

For every line key carried by 2 to 12 families and at least 20 characters long,
one LineString from the first line of the carrier that sits earliest in the
numbering (lowest first key) to the first line of the carrier that sits latest
(highest first key). The 3,000 longest spans are kept. Written to
layers/tunnels.json with build_layers.write_layer, which refuses invented keys.

Paths come from this file's location; if the numbered database is not beside
the repo (a git worktree elsewhere, say), GALAXIES_GITHUB names the GitHub folder.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_layers as bl  # noqa: E402

MIN_FAMILIES, MAX_FAMILIES, MIN_CHARS, KEEP = 2, 12, 20, 3000


def resolve_pack() -> Path:
    tail = Path("globalgrid2050") / "testcode" / "202609142202" / "data"
    candidates = [bl.PACK]
    if os.environ.get("GALAXIES_GITHUB"):
        candidates.insert(0, Path(os.environ["GALAXIES_GITHUB"]) / tail)
    for c in candidates:
        if (c / "families.json").exists():
            return c
    raise SystemExit("numbered database not found; set GALAXIES_GITHUB to the folder holding globalgrid2050. "
                     f"tried: {[str(c) for c in candidates]}")


def main() -> int:
    bl.PACK = resolve_pack()
    E = bl.ESTATE = bl.load_estate()
    fams = E["families"]
    first = [bl.first_key(E, i) for i in range(len(fams))]

    considered = 0
    feats = []
    for k, carriers in E["owner"].items():
        if not (MIN_FAMILIES <= len(carriers) <= MAX_FAMILIES) or E["lens"].get(k, 0) < MIN_CHARS:
            continue
        cs = [c for c in carriers if first[c] is not None]
        if len(cs) < 2:
            continue
        considered += 1
        early = min(cs, key=lambda c: first[c])
        late = max(cs, key=lambda c: first[c])
        span = abs(first[late] - first[early])
        if span == 0:
            continue
        fe, fl = fams[early], fams[late]
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "keys": [first[early], first[late]]},
                      "properties": {"key": k, "families": len(carriers), "chars": E["lens"][k], "span": span,
                                     "early": {"family": fe["n"], "name": fe["name"], "first": first[early]},
                                     "late": {"family": fl["n"], "name": fl["name"], "first": first[late]}}})
    candidates = len(feats)
    feats.sort(key=lambda f: -f["properties"]["span"])
    feats = feats[:KEEP]

    # every key a tunnel names must exist: its two ends and the shared line itself
    for f in feats:
        for key in f["geometry"]["keys"] + [f["properties"]["key"]]:
            assert key in E["keyset"], f"key {key} is not in the numbered database"

    stats = {"features": len(feats), "lines_considered": considered, "tunnels_with_span": candidates,
             "span_max": feats[0]["properties"]["span"] if feats else 0,
             "span_min_kept": feats[-1]["properties"]["span"] if feats else 0}
    p = bl.write_layer(
        {"id": "tunnels", "label": "Tunnels", "group": "WHAT IS WRITTEN TWICE", "preload": False,
         "colour": "#ff2bd6", "draws": "arcs",
         "evidence": "lines carried by 2 to 12 families and 20+ characters, joined from the earliest carrier's "
                     "first line to the latest carrier's; the 3,000 longest spans",
         "note": "Quantum tunnelling, in code. Two families far apart on the wafer are, on this line, the same "
                 "text: a tunnel between two regions of the numbering."},
        feats, stats, E["sources"])
    print(f"estate: {len(E['keys']):,} lines, {len(fams):,} families")
    print(f"lines carried by {MIN_FAMILIES}-{MAX_FAMILIES} families and >= {MIN_CHARS} chars: {considered:,}")
    print(f"tunnels with nonzero span: {candidates:,}; kept {len(feats):,}")
    print(f"span max {stats['span_max']:,}, shortest kept {stats['span_min_kept']:,}")
    print(f"all {len(feats) * 3:,} keys named exist; wrote {p} ({p.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
