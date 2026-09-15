#!/usr/bin/env python3
"""Build the galaxy's layers from the estate's own numbered records.

THE FORMAT. Every layer is one file in layers/, shaped like GeoJSON so anyone
who has read a Grid Atlas layer can read this one, with one deliberate
difference: a feature's geometry carries PERMANENT KEYS, never coordinates.

    {
      "type": "CodeFeatureCollection",
      "substrate": "wafer.v1",
      "layer": { "id", "label", "group", "preload", "colour", "evidence", "note" },
      "provenance": { "built_utc", "sources": [ { "path"|"url", "sha256"|"blob" } ] },
      "stats": { ... counted here, never typed },
      "features": [
        { "type": "Feature", "geometry": { "type": "Point", "key": 8285 },
          "properties": { ... } },
        { "type": "Feature", "geometry": { "type": "LineString", "keys": [3, 4] },
          "properties": { ... } }
      ]
    }

WHY KEYS AND NOT COORDINATES. The substrate is frozen: a key's position is
fixed by wafer.mjs and never changes. If a layer carried coordinates it could
disagree with the ground, and on the day the two disagreed nobody could say
which was right. A layer that carries only keys cannot be wrong about where
anything is. It can only be wrong about what it says, and that is what its
evidence field is for.

WHAT A LAYER MAY NOT DO. Invent a key. Every key in every feature must exist in
the numbered database; the build refuses to write a layer that names one that
does not. A layer states the evidence for each feature, and a relationship
learned from a recorded failure is marked differently from one an author
declared.

PROVENANCE. Local sources are hashed from their bytes; the build writes the
hash beside the path so the layer can be traced to exactly what it was built
from.
"""
from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = REPO / "layers"
GITHUB = REPO.parent
PACK = GITHUB / "globalgrid2050" / "testcode" / "202609142202" / "data"
STARMAKER = GITHUB / "star-maker"
BLOCKS_URL = "https://ventusltd.github.io/stars/blocks/blocks.json"

SUBSTRATE = "wafer.v1"
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def u32(p: Path) -> list[int]:
    b = p.read_bytes()
    return list(struct.unpack(f"<{len(b) // 4}I", b))


def u16(p: Path) -> list[int]:
    b = p.read_bytes()
    return list(struct.unpack(f"<{len(b) // 2}H", b))


def load_estate():
    meta = json.loads((PACK / "all-lines.meta.json").read_text(encoding="utf-8"))
    keys = u32(PACK / "all-lines.bin")
    lens = u16(PACK / "all-lines.len.bin")
    families = json.loads((PACK / "families.json").read_text(encoding="utf-8"))
    fam_lines = u32(PACK / "lines.bin")
    owner: dict[int, list[int]] = defaultdict(list)
    for f, fam in enumerate(families):
        o, c = fam["lineOffset"], fam["lineCount"]
        for i in range(o, o + c):
            k = fam_lines[i]
            cur = owner[k]
            if not cur or cur[-1] != f:
                cur.append(f)
    sources = [{"path": f"globalgrid2050/testcode/202609142202/data/{n}", "sha256": sha256_file(PACK / n)}
               for n in ("all-lines.meta.json", "all-lines.bin", "all-lines.len.bin",
                         "families.json", "lines.bin")]
    return {
        "meta": meta, "keys": keys, "keyset": set(keys), "lens": dict(zip(keys, lens)),
        "families": families, "fam_lines": fam_lines, "owner": owner, "sources": sources,
    }


def first_key(E, family_index: int):
    fam = E["families"][family_index]
    return E["fam_lines"][fam["lineOffset"]] if fam["lineCount"] else None


def write_layer(layer: dict, features: list, stats: dict, sources: list) -> Path:
    for f in features:
        g = f["geometry"]
        keys = [g["key"]] if g["type"] == "Point" else g["keys"]
        for k in keys:
            if k not in ESTATE["keyset"]:
                raise SystemExit(f"layer {layer['id']} names key {k}, which the numbered database does not "
                                 "contain. A layer may not invent a key.")
    doc = {
        "type": "CodeFeatureCollection",
        "substrate": SUBSTRATE,
        "layer": layer,
        "provenance": {"built_utc": NOW, "sources": sources},
        "stats": stats,
        "features": features,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{layer['id']}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


# ── layer builders ──────────────────────────────────────────────────────────

def layer_copying(E):
    """Real copying: lines in 2 to 40 families and at least 12 characters."""
    feats, n = [], 0
    for k, fams in E["owner"].items():
        if not (2 <= len(fams) <= 40) or E["lens"].get(k, 0) < 12:
            continue
        n += 1
        feats.append({"type": "Feature", "geometry": {"type": "Point", "key": k},
                      "properties": {"families": len(fams), "chars": E["lens"][k]}})
    return write_layer(
        {"id": "copying", "label": "Real copying", "group": "WHAT IS WRITTEN TWICE", "preload": False,
         "colour": "#ff8a65",
         "evidence": "lines carried by 2 to 40 function families and at least 12 characters long",
         "note": "Where the estate genuinely repeats itself. Lines in more than forty families are structure, "
                 "braces and imports, and lines under twelve characters carry too little to be evidence; both "
                 "are discarded, and what remains is the copying worth a human look."},
        feats, {"features": n, "discarded_rule": "families > 40 or chars < 12"}, E["sources"])


def layer_crossname(E):
    """Two differently named families that share lines and where neither contains the other."""
    norm = lambda s: "".join(ch for ch in (s or "").lower() if ch.isalnum())
    fam_sets = {}

    def fam_set(i):
        if i not in fam_sets:
            f = E["families"][i]
            fam_sets[i] = set(E["fam_lines"][f["lineOffset"]:f["lineOffset"] + f["lineCount"]])
        return fam_sets[i]

    pair: dict[tuple[int, int], list[int]] = defaultdict(list)
    F = len(E["families"])
    for k, fams in E["owner"].items():
        if not (2 <= len(fams) <= 40) or E["lens"].get(k, 0) < 12:
            continue
        for a_i in range(len(fams)):
            for b_i in range(a_i + 1, len(fams)):
                a, b = fams[a_i], fams[b_i]
                if norm(E["families"][a]["name"]) == norm(E["families"][b]["name"]):
                    continue
                pair[(a, b)].append(k)

    feats, contained = [], 0
    for (a, b), shared in pair.items():
        if len(shared) < 6:
            continue
        A, B = fam_set(a), fam_set(b)
        small, big = (A, B) if len(A) <= len(B) else (B, A)
        inter = len(small & big)
        if inter == len(small):
            contained += 1
            continue
        jac = inter / (len(A) + len(B) - inter)
        ka, kb = first_key(E, a), first_key(E, b)
        if ka is None or kb is None:
            continue
        fa, fb = E["families"][a], E["families"][b]
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "keys": [ka, kb]},
                      "properties": {"overlap": round(jac, 4), "shared": inter,
                                     "a": {"family": fa["n"], "name": fa["name"], "category": fa["category"]},
                                     "b": {"family": fb["n"], "name": fb["name"], "category": fb["category"]}}})
    feats.sort(key=lambda f: -f["properties"]["overlap"])
    feats = feats[:400]
    return write_layer(
        {"id": "crossname", "label": "Copied under another name", "group": "WHAT IS WRITTEN TWICE",
         "preload": False, "colour": "#f06292", "draws": "lines",
         "evidence": "pairs of differently named families sharing 6+ usable lines, neither containing the other",
         "note": "The copying nobody recorded. Two functions with different names and substantially the same "
                 "body. Pairs where one family wholly contains the other are excluded because they are a class "
                 "and its own method, not a copy. The strongest four hundred are drawn."},
        feats, {"features": len(feats), "excluded_as_containment": contained}, E["sources"])


def layer_blocks(E, doc):
    """Every numbered line inside a function family that a named block claims."""
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    feats, seen = [], set()
    for blk in doc["blocks"]:
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            if fi is None:
                continue
            k = first_key(E, fi)
            if k is None or k in seen:
                continue
            seen.add(k)
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": k},
                          "properties": {"block": blk["symbol"], "title": blk["title"],
                                         "category": blk["category"], "function": fn["name"],
                                         "family": fn["family"]}})
    return write_layer(
        {"id": "blocks", "label": "Functions in a named block", "group": "THE WORKING MODULES", "preload": False,
         "colour": "#5ec8f2",
         "evidence": "the live block register, each function family a block names, placed at its first line",
         "note": "Every function the estate has put inside a numbered block, placed where that function's first "
                 "line sits on the wafer. These are the modules with a repository, a commit and a path. Tap one "
                 "to see which block claims it."},
        feats, {"features": len(feats), "blocks": len(doc["blocks"])},
        E["sources"] + [{"url": BLOCKS_URL, "generated_utc": doc.get("generated_utc")}])


def layer_engine(E, doc):
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    feats, blocks = [], set()
    for blk in doc["blocks"]:
        if not any("ventus-grid-engine" in r for r in (blk.get("repos") or [])):
            continue
        blocks.add(blk["symbol"])
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            k = first_key(E, fi) if fi is not None else None
            if k is None:
                continue
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": k},
                          "properties": {"block": blk["symbol"], "title": blk["title"], "function": fn["name"]}})
    return write_layer(
        {"id": "engine", "label": "The grid engine", "group": "THE WORKING MODULES", "preload": False,
         "colour": "#7fd6a2",
         "evidence": "blocks whose repository is Ventusltd/ventus-grid-engine in the live register",
         "note": "The grid mathematics: distance and bearing, voltage drop, firm capacity, connection capacity, "
                 "ratings, route obstacles. The smallest layer on the wafer and the one the estate exists to "
                 "serve."},
        feats, {"features": len(feats), "blocks": sorted(blocks)},
        E["sources"] + [{"url": BLOCKS_URL, "generated_utc": doc.get("generated_utc")}])


def layer_declared(E, doc):
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    by_sym = {b["symbol"]: b for b in doc["blocks"]}

    def anchor(blk):
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            k = first_key(E, fi) if fi is not None else None
            if k is not None:
                return k
        return None

    feats, unanchored = [], 0
    for blk in doc["blocks"]:
        a = anchor(blk)
        for d in blk.get("depends_on") or []:
            t = by_sym.get(d["symbol"])
            z = anchor(t) if t else None
            if a is None or z is None:
                unanchored += 1
                continue
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "keys": [a, z]},
                          "properties": {"from": blk["symbol"], "to": d["symbol"],
                                         "via": d.get("via") or [], "evidence": "declared"}})
    return write_layer(
        {"id": "declared", "label": "Declared dependencies", "group": "WHAT FITS WITH WHAT", "preload": False,
         "colour": "#8ea8ff", "draws": "lines",
         "evidence": "depends_on in the live block register",
         "note": "What the authors wrote down: block A depends on block B, drawn between the first numbered "
                 "line of each. It is thin, because most of the estate declares nothing at all."},
        feats, {"features": len(feats), "unanchored": unanchored},
        E["sources"] + [{"url": BLOCKS_URL, "generated_utc": doc.get("generated_utc")}])


def layer_learned(E, doc):
    """Rules the chemistry star learned from recorded composition failures."""
    comp_path = STARMAKER / "chemistry" / "compounds.json"
    data = json.loads(comp_path.read_text(encoding="utf-8"))
    compounds = data.get("compounds", data)
    counts: dict[str, int] = defaultdict(int)
    for c in compounds:
        for d in c.get("decays") or []:
            counts[d["text"]] += d["n"]

    import re
    rule = re.compile(r"^[\w-]+:\s*Error:\s*([\w-]+)\s+requires\s+the\s+([\w-]+)\s+module", re.I)
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}

    def find(word):
        for b in doc["blocks"]:
            if word in (b.get("title") or "").lower() or word in (b.get("description") or "").lower():
                return b
        return None

    def anchor(blk):
        for fn in (blk or {}).get("inside") or []:
            fi = by_n.get(fn["family"])
            k = first_key(E, fi) if fi is not None else None
            if k is not None:
                return k
        return None

    feats, unanchored = [], []
    for text, n in counts.items():
        m = rule.match(text)
        if not m:
            continue
        a, z = anchor(find(m.group(1))), anchor(find(m.group(2)))
        if a is None or z is None:
            unanchored.append({"rule": f"{m.group(1)} requires {m.group(2)}", "failures": n})
            continue
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "keys": [a, z]},
                      "properties": {"from": m.group(1), "to": m.group(2), "failures": n,
                                     "message": text, "evidence": "learned by failure"}})
    return write_layer(
        {"id": "learned", "label": "Learned by failure", "group": "WHAT FITS WITH WHAT", "preload": False,
         "colour": "#ffd54a", "draws": "lines",
         "evidence": "the chemistry star's recorded composition failures",
         "note": "Rules nobody declared that the estate learned by trying. Each line is a decay message counted "
                 "across compositions, and the count is carried with it."},
        feats, {"features": len(feats), "compounds": len(compounds),
                "failures": sum(c.get("red", 0) for c in compounds), "unanchored": unanchored},
        E["sources"] + [{"path": "star-maker/chemistry/compounds.json", "sha256": sha256_file(comp_path)}])


def main() -> int:
    global ESTATE
    ESTATE = load_estate()
    with urllib.request.urlopen(BLOCKS_URL, timeout=60) as r:
        blocks_doc = json.loads(r.read().decode("utf-8"))

    built = [layer_copying(ESTATE), layer_crossname(ESTATE), layer_blocks(ESTATE, blocks_doc),
             layer_engine(ESTATE, blocks_doc), layer_declared(ESTATE, blocks_doc),
             layer_learned(ESTATE, blocks_doc)]

    manifest = {"substrate": SUBSTRATE, "built_utc": NOW, "layers": []}
    for p in built:
        d = json.loads(p.read_text(encoding="utf-8"))
        manifest["layers"].append({**d["layer"], "file": f"layers/{p.name}", "bytes": p.stat().st_size,
                                   "features": len(d["features"]), "sha256": sha256_file(p)})
        print(f"  {d['layer']['id']:<11} {len(d['features']):>7} features  {p.stat().st_size:>10,} bytes  "
              f"{json.dumps(d['stats'])[:90]}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"manifest: {len(built)} layers on substrate {SUBSTRATE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
