#!/usr/bin/env python3
"""Build two shell layers: the star generator and the spider.

Both sit in THE WORKING MODULES and follow the schema in build_layers.py (keys,
never coordinates; every key checked against the numbered database; a hash for
every source read; stats counted, never typed). This file reuses that module's
load_estate, first_key and write_layer and adds nothing to the format.

  star-generator  every function family named by a block whose files[].path
                  starts testcode/202609142225/ in the live register, placed at
                  its first line. Each carries the 13-parameter shell.
  spider          the register is searched for Ventusltd/ventus-grid-engine at
                  index.html or spider/. It knows nothing there, so the layer
                  ships EMPTY with the reason in stats.why. An empty layer with
                  a reason is a finding; an invented key is a breach.

The layers are written into layers/ and their entries added to (or replaced in)
layers/manifest.json; the other entries are left exactly as they were.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_layers as BL  # noqa: E402

STAR_FOLDER = "testcode/202609142225/"
STAR_SHELL = ["key", "block", "family", "graph", "focus", "blocks", "lens", "trail", "recipe", "m",
              "edges", "cat", "data"]
SPIDER_REPO = "Ventusltd/ventus-grid-engine"
SPIDER_PATHS = ["index.html", "spider/"]
SPIDER_SHELL = ["graph", "focus"]
PACK_TAIL = Path("globalgrid2050") / "testcode" / "202609142202" / "data"


def resolve_pack() -> Path:
    """The numbered database lives beside the repository's checkout. A worktree may sit elsewhere, so
    look under an explicit GALAXIES_GITHUB first, then beside the repo, then the home GitHub folder."""
    cands = [BL.GITHUB, Path.home() / "Documents" / "GitHub"]
    if os.environ.get("GALAXIES_GITHUB"):
        cands.insert(0, Path(os.environ["GALAXIES_GITHUB"]))
    for c in cands:
        if (c / PACK_TAIL / "families.json").exists():
            return c / PACK_TAIL
    raise SystemExit("numbered database not found; set GALAXIES_GITHUB to the folder holding globalgrid2050")


def layer_star_generator(E, doc, reg_src):
    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    feats, blocks, unresolved, live_mismatch, other_files = [], [], [], [], []
    for blk in doc["blocks"]:
        files = blk.get("files") or []
        if not any((f.get("path") or "").startswith(STAR_FOLDER) for f in files):
            continue
        blocks.append(blk["symbol"])
        live = blk.get("live") or []
        if not any(f"/{STAR_FOLDER}" in u for u in live):
            live_mismatch.append({"block": blk["symbol"], "title": blk["title"],
                                  "files_path": [f["path"] for f in files if f["path"].startswith(STAR_FOLDER)],
                                  "live": live})
        for f in files:
            if not f["path"].startswith(STAR_FOLDER):
                other_files.append({"block": blk["symbol"], "path": f["path"]})
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            k = BL.first_key(E, fi) if fi is not None else None
            if k is None:
                unresolved.append({"block": blk["symbol"], "family": fn["family"], "function": fn["name"]})
                continue
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": k},
                          "properties": {"block": blk["symbol"], "title": blk["title"], "function": fn["name"],
                                         "family": fn["family"], "shell": STAR_SHELL}})
    per_block = {s: sum(1 for f in feats if f["properties"]["block"] == s) for s in blocks}
    stats = {"features": len(feats), "blocks_searched": len(doc["blocks"]), "blocks": blocks,
             "per_block": per_block, "distinct_keys": len({f["geometry"]["key"] for f in feats}),
             "unresolved": unresolved,
             "database_max_family": max(by_n),
             "unresolved_above_database": sum(1 for u in unresolved if u["family"] > max(by_n)),
             "unresolved_why": "a family the register names that the numbered database does not contain has no "
                               "first line to place; it is listed here, never given an invented key",
             "live_mismatch": live_mismatch,
             "files_outside_folder": other_files, "shell": STAR_SHELL}
    return BL.write_layer(
        {"id": "star-generator", "label": "The star generator", "group": "THE WORKING MODULES", "preload": False,
         "colour": "#f48fb1",
         "evidence": f"blocks in the live register with files[].path under {STAR_FOLDER}, each function family "
                     "they name placed at its first line",
         "note": "The generator that draws a star: its core, its bench and its interface, as the register "
                 "records them. Every function carries the same thirteen-parameter shell. Where a block's live "
                 "address points at a different folder from its files, stats.live_mismatch says so."},
        feats, stats, E["sources"] + [reg_src])


def layer_spider(E, doc, reg_src):
    hits = []
    for blk in doc["blocks"]:
        for f in blk.get("files") or []:
            p = f.get("path") or ""
            if f.get("repo") == SPIDER_REPO and (p == "index.html" or p.startswith("spider/")):
                hits.append({"block": blk["symbol"], "path": p})
    if hits:
        raise SystemExit(f"the register now knows the spider ({hits}); this builder ships it empty and must be "
                         "rewritten to draw it, not left to claim it is absent")
    n = len(doc["blocks"])
    why = (f"Searched all {n} blocks of the live register ({BL.BLOCKS_URL}, generated "
           f"{doc.get('generated_utc')}) for files[] with repo {SPIDER_REPO} and path index.html or a path "
           f"under spider/. None matched: the register does not know the spider, so no key can be placed "
           f"without inventing one.")
    return BL.write_layer(
        {"id": "spider", "label": "The spider", "group": "THE WORKING MODULES", "preload": False,
         "colour": "#b39ddb",
         "evidence": f"files[] in the live register with repo {SPIDER_REPO} at index.html or spider/",
         "note": "The grid engine's spider, a two-parameter shell (graph, focus). It ships empty because the "
                 "register has no block for it; the emptiness is the finding, recorded in stats.why."},
        [], {"features": 0, "blocks_searched": n, "repo": SPIDER_REPO, "paths": SPIDER_PATHS,
             "why": why, "shell": SPIDER_SHELL}, E["sources"] + [reg_src])


def main() -> int:
    BL.PACK = resolve_pack()
    BL.ESTATE = BL.load_estate()
    with urllib.request.urlopen(BL.BLOCKS_URL, timeout=60) as r:
        raw = r.read()
    doc = json.loads(raw.decode("utf-8"))
    reg_src = {"url": BL.BLOCKS_URL, "generated_utc": doc.get("generated_utc"),
               "sha256": hashlib.sha256(raw).hexdigest()}

    built = [layer_star_generator(BL.ESTATE, doc, reg_src), layer_spider(BL.ESTATE, doc, reg_src)]

    mpath = BL.OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    for p in built:
        d = json.loads(p.read_text(encoding="utf-8"))
        entry = {**d["layer"], "file": f"layers/{p.name}", "bytes": p.stat().st_size,
                 "features": len(d["features"]), "sha256": BL.sha256_file(p)}
        manifest["layers"] = [e for e in manifest["layers"] if e["id"] != entry["id"]] + [entry]
        print(f"  {d['layer']['id']:<15} {len(d['features']):>5} features  {p.stat().st_size:>8,} bytes  "
              f"{json.dumps(d['stats'])[:160]}")
    mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"manifest: {len(manifest['layers'])} layers on substrate {BL.SUBSTRATE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
