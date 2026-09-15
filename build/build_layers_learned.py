#!/usr/bin/env python3
"""Rebuild layers/learned.json with anchoring that goes through the element table.

WHY THIS FILE EXISTS. build_layers.layer_learned anchors each rule by searching
block titles and descriptions for the module's name. The names in a decay
message (sld-sandbox, sld-styles, grid-scope, geodesy) are cartridge names, not
block titles, so the search found nothing usable and the layer was written
empty. build_layers.py is left untouched; this file imports its helpers and
overwrites learned.json and the learned entry in layers/manifest.json.

THE ANCHORING, exactly:

    name  --star-maker/elements/table.json (element.name, exact)-->  symbol
    symbol --live block register (block.symbol)-->                   block
    block.inside[] --first family that has a numbered line-->        key

No fuzzy match is accepted. A name the table does not hold, a symbol the
register does not hold, or a block whose inside[] carries no numbered line is
recorded in stats.unanchored with that exact reason. Near names are reported
beside the reason so a human can decide, but they are never used to place a
mark.

WHAT IS DRAWN. A decay message is recorded against the element that decayed:
the text before the first colon ("sld-sandbox: Error: ..."). Each rule is drawn
as a Point at that emitter's anchor when the emitter anchors. A LineString from
the requiring module to the required module is drawn only when both ends
anchor; a rule with an unanchored end stays in stats.unanchored and its line is
not drawn. A Point says "this failure was recorded here", never "this is
coupled to that".
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_layers as bl  # noqa: E402

RULE = re.compile(r"^([\w-]+):\s*Error:\s*([\w-]+)\s+requires\s+the\s+([\w-]+)\s+module", re.I)
TABLE_PATH = bl.STARMAKER / "elements" / "table.json"
COMP_PATH = bl.STARMAKER / "chemistry" / "compounds.json"


def main() -> int:
    E = bl.load_estate()
    bl.ESTATE = E  # write_layer reads the module global

    with urllib.request.urlopen(bl.BLOCKS_URL, timeout=60) as r:
        raw = r.read()
    doc = json.loads(raw.decode("utf-8"))
    blocks_sha = hashlib.sha256(raw).hexdigest()

    table = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
    elements = table.get("elements", table)
    by_name = {e["name"]: e for e in elements}
    by_sym = {b["symbol"]: b for b in doc["blocks"]}
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}

    comp = json.loads(COMP_PATH.read_text(encoding="utf-8"))
    compounds = comp.get("compounds", comp)
    counts: dict[str, int] = defaultdict(int)
    for c in compounds:
        for d in c.get("decays") or []:
            counts[d["text"]] += d["n"]

    def resolve(name: str) -> dict:
        """Name -> {key, symbol, family, block} or {reason, near}."""
        el = by_name.get(name)
        if el is None:
            word = name.lower()
            near = [f"{e['symbol']} {e['name']} ({e['family']})" for e in elements
                    if word in e["name"].lower() or e["name"].lower() in word]
            fam_hint = sorted({f"{f['name']} (family {f['n']}, block {f.get('block')})"
                               for f in E["families"]
                               if word.replace("-", "") == (f.get("name") or "").lower()
                               or (len(word) > 4 and word.replace("-", "") in (f.get("name") or "").lower())})[:6]
            out = {"reason": f"no element in star-maker/elements/table.json is named '{name}' "
                             f"({len(elements)} elements searched by exact name)"}
            if near:
                out["near_names_not_accepted"] = near
                for e in elements:
                    if f"{e['symbol']} {e['name']} ({e['family']})" in near:
                        b = by_sym.get(e["symbol"])
                        if b is not None and not any(by_n.get(fn["family"]) is not None
                                                     and E["families"][by_n[fn["family"]]]["lineCount"]
                                                     for fn in b.get("inside") or []):
                            out["reason"] += (f"; the nearest name, {e['symbol']} '{e['name']}', would not anchor "
                                              f"either: register block {e['symbol']} has "
                                              f"{len(b.get('inside') or [])} inside families with a numbered line")
            if fam_hint:
                out["function_names_not_accepted"] = fam_hint
            return out
        sym = el["symbol"]
        blk = by_sym.get(sym)
        if blk is None:
            return {"reason": f"element {sym} '{name}' is in the table but the live register has no block "
                              f"with symbol {sym}"}
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            k = bl.first_key(E, fi) if fi is not None else None
            if k is not None:
                return {"key": k, "symbol": sym, "block": blk["title"], "family": fn["family"],
                        "function": fn["name"]}
        return {"reason": f"element {sym} '{name}' maps to register block {sym}, whose inside[] has "
                          f"{len(blk.get('inside') or [])} families and none with a numbered line in the database"}

    feats, unanchored, points, lines = [], [], 0, 0
    for text, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        m = RULE.match(text)
        if not m:
            continue
        emitter, frm, to = m.group(1), m.group(2), m.group(3)
        rule = f"{frm} requires {to}"
        E_, A, Z = resolve(emitter), resolve(frm), resolve(to)
        base = {"rule": rule, "failures": n, "message": text, "evidence": "learned by failure"}

        if "key" in A and "key" in Z:
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "keys": [A["key"], Z["key"]]},
                          "properties": {**base, "from": frm, "to": to,
                                         "from_symbol": A["symbol"], "to_symbol": Z["symbol"]}})
            lines += 1
        else:
            ends = {}
            for end, name, R in (("from", frm, A), ("to", to, Z)):
                ends[end] = {"name": name, **({"symbol": R["symbol"], "key": R["key"]} if "key" in R else R)}
            unanchored.append({"rule": rule, "failures": n, **ends})

        if "key" in E_:
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": E_["key"]},
                          "properties": {**base, "at": "emitter", "emitter": emitter,
                                         "emitter_symbol": E_["symbol"], "emitter_block": E_["block"],
                                         "anchor_function": E_["function"], "anchor_family": E_["family"],
                                         "from": frm, "to": to,
                                         "line_drawn": "key" in A and "key" in Z}})
            points += 1
        else:
            unanchored.append({"rule": rule, "failures": n, "emitter": {"name": emitter, **E_}})

    sources = E["sources"] + [
        {"url": bl.BLOCKS_URL, "generated_utc": doc.get("generated_utc"), "sha256": blocks_sha},
        {"path": "star-maker/chemistry/compounds.json", "sha256": bl.sha256_file(COMP_PATH)},
        {"path": "star-maker/elements/table.json", "sha256": bl.sha256_file(TABLE_PATH)},
    ]
    layer = {"id": "learned", "label": "Learned by failure", "group": "WHAT FITS WITH WHAT", "preload": False,
             "colour": "#ffd54a",
             "evidence": "the chemistry star's recorded composition failures, anchored through the element table",
             "note": "Rules nobody declared that the estate learned by trying. Each mark is a decay message counted "
                     "across compositions, placed at the element that recorded the failure (the first numbered "
                     "line of its register block). A line between two modules is drawn only when both are "
                     "elements in the table; the modules that are not are listed as unanchored with the reason."}
    stats = {"features": len(feats), "points_at_emitter": points, "lines_between_modules": lines,
             "compounds": len(compounds), "failures": sum(c.get("red", 0) for c in compounds),
             "anchoring": "name -> elements/table.json symbol -> register block -> first inside family's first line",
             "unanchored": unanchored}
    path = bl.write_layer(layer, feats, stats, sources)

    mpath = bl.OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    d = json.loads(path.read_text(encoding="utf-8"))
    entry = {**d["layer"], "file": f"layers/{path.name}", "bytes": path.stat().st_size,
             "features": len(d["features"]), "sha256": bl.sha256_file(path)}
    manifest["layers"] = [entry if l["id"] == "learned" else l for l in manifest["layers"]]
    mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"  learned {len(feats)} features ({points} points at emitter, {lines} lines), "
          f"{path.stat().st_size:,} bytes")
    for u in unanchored:
        print("  unanchored:", json.dumps(u, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
