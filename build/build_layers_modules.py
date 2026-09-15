#!/usr/bin/env python3
"""One layer per working module: its lines are its coordinates, drawn as a route.

VIKRAM'S RULE, verbatim: "use the code lines as the coordinates and draw the
railway lines or whatever lines you want using existing work modules with
minimum of 10 lines so anything that has more than 10 lines give them a layer
and then list those layers in the wafer using the css from the atlas layers and
then draw through those coordinates".

So: every block in the live register that carries working code and names at
least ten numbered lines becomes a layer, `layers/modules/<symbol>.json`. Each
of its function families is one LineString through that family's line numbers
in the order they were written, which on the wafer is the route that function
takes across the numbering; and one Point at the family's first line, so a
module with a single short family still has a mark. The layer's group is the
block's category and its colour comes from one palette per category, so the
panel reads like the Atlas's groups.

WHAT IS NOT CLAIMED. A route through a family's keys is the order the lines
were numbered, which is the order they were first seen. It is not control flow
and it is not a call graph. Two routes that cross share nothing but a place.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_layers as BL  # noqa: E402

BLOCKS_URL = "https://ventusltd.github.io/stars/blocks/blocks.json"
MIN_LINES = 10
OUT = BL.OUT / "modules"

# One colour per category, in the Atlas's own register: neon on black, every
# category distinct. Categories not listed fall to grey.
PALETTE = {
    "geodesy": "#00cc00", "network": "#0054ff", "connections": "#ff0000", "constants": "#ff9900",
    "cartridges": "#ffff00", "layers": "#b200ff", "arrival": "#ff00ff", "news": "#ff4500",
    "solar": "#ffd700", "interface": "#00ffff", "proofs": "#39ff14", "other": "#8b93a7",
}


def main() -> int:
    BL.ESTATE = BL.load_estate()
    E = BL.ESTATE
    with urllib.request.urlopen(BLOCKS_URL, timeout=60) as r:
        doc = json.loads(r.read().decode("utf-8"))
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    OUT.mkdir(parents=True, exist_ok=True)

    manifest_path = BL.OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["layers"] = [l for l in manifest["layers"] if not str(l.get("file", "")).startswith("layers/modules/")]

    made, skipped_short, skipped_nocode, unresolved_total = 0, 0, 0, 0
    for blk in sorted(doc["blocks"], key=lambda b: b["number"]):
        if not blk.get("files") or blk.get("functions", 0) == 0:
            skipped_nocode += 1
            continue
        feats, lines_total, unresolved = [], 0, []
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            if fi is None:
                unresolved.append(fn["family"])
                continue
            fam = E["families"][fi]
            keys = E["fam_lines"][fam["lineOffset"]:fam["lineOffset"] + fam["lineCount"]]
            keys = [k for k in keys if k in E["keyset"]]
            if not keys:
                unresolved.append(fn["family"])
                continue
            lines_total += len(keys)
            props = {"block": blk["symbol"], "function": fn["name"], "family": fn["family"], "lines": len(keys)}
            if len(keys) >= 2:
                feats.append({"type": "Feature", "geometry": {"type": "LineString", "keys": keys},
                              "properties": {**props, "route": "the family's lines in numbering order"}})
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": keys[0]},
                          "properties": {**props, "mark": "first line"}})
        if lines_total < MIN_LINES:
            skipped_short += 1
            continue
        unresolved_total += len(unresolved)
        cat = blk.get("category") or "other"
        layer = {
            "id": f"module-{blk['symbol']}", "label": f"{blk['symbol']} · {blk['title']}",
            "group": f"MODULES · {cat.upper()}", "preload": False, "colour": PALETTE.get(cat, "#8b93a7"),
            "draws": "lines",
            "evidence": f"the live block register: block {blk['symbol']} #{blk['number']}, {len(blk['inside'] or [])} named "
                        f"families, {lines_total} numbered lines, repository {', '.join(blk.get('repos') or []) or 'unstated'}",
            "note": (blk.get("description") or "") or f"{blk['title']}: each function drawn as the route its lines take "
                    "through the numbering, with a mark at its first line.",
        }
        stats = {"features": len(feats), "families": len(blk["inside"] or []), "lines": lines_total,
                 "unresolved_families": unresolved, "files": [f["path"] for f in blk["files"]][:6],
                 "commit": blk["files"][0].get("commit")}
        path = BL.write_layer(layer, feats, stats, E["sources"] + [{"url": BLOCKS_URL, "generated_utc": doc.get("generated_utc")}])
        # write_layer puts the file in layers/; move it under layers/modules/
        target = OUT / path.name
        target.write_bytes(path.read_bytes()); path.unlink()
        manifest["layers"].append({**layer, "file": f"layers/modules/{target.name}", "bytes": target.stat().st_size,
                                   "features": len(feats), "sha256": BL.sha256_file(target)})
        made += 1

    manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"module layers: {made} written, {skipped_short} blocks under {MIN_LINES} lines skipped, "
          f"{skipped_nocode} without code skipped, {unresolved_total} families unresolved (register newer than pack)")
    print(f"manifest: {len(manifest['layers'])} layers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
