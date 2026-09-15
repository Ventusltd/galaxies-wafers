#!/usr/bin/env python3
"""Iteration 22: tile every large layer by radius band, into this directory.

The same law as build/tile_layer.py, which this reads and does not change:
r = sqrt(key), so the ring [b*S, (b+1)*S) is exactly the key range
[(b*S)^2, ((b+1)*S)^2); a key's band is isqrt(key) // S. A Point is banded by
its key and a LineString by its first key, so each feature is in exactly one
tile. Only layers with more than TILE_OVER features are tiled; the rest stay
whole files, because a small file is one cheap fetch.

Writes iterations/22-fast-zoom/tiles/<id>/<band>.json and index.json, and
tiles/index.json naming every tiled layer. Run from the repository root:

    python iterations/22-fast-zoom/build_tiles.py
"""
from __future__ import annotations
import hashlib, json, math, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
LAYERS = REPO / "layers"
OUT = HERE / "tiles"
S = 25
TILE_OVER = 5000


def anchor(f):
    g = f["geometry"]
    return g["key"] if g["type"] == "Point" else g["keys"][0]


def tile(entry):
    lid = entry["id"]
    src = REPO / entry["file"]
    raw = src.read_bytes()
    doc = json.loads(raw)
    max_key = max(anchor(f) for f in doc["features"])
    bands_n = math.isqrt(max_key) // S + 1
    buckets = [[] for _ in range(bands_n)]
    for f in doc["features"]:
        buckets[math.isqrt(anchor(f)) // S].append(f)
    out = OUT / lid
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    bands = []
    for b, feats in enumerate(buckets):
        kmin, kmax = (b * S) ** 2, ((b + 1) * S) ** 2
        assert all(kmin <= anchor(f) < kmax for f in feats)
        t = {"type": "CodeFeatureCollection", "substrate": doc.get("substrate"), "layer": doc["layer"],
             "provenance": doc["provenance"], "tile": {"band": b, "key_min": kmin, "key_max": kmax}, "features": feats}
        data = json.dumps(t, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (out / f"{b}.json").write_bytes(data)
        bands.append({"band": b, "key_min": kmin, "key_max": kmax, "file": f"tiles/{lid}/{b}.json",
                      "features": len(feats), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    total = sum(x["features"] for x in bands)
    assert total == len(doc["features"]), "tiles lost or duplicated features"
    index = {"type": "CodeTileIndex", "layer_id": lid, "stats": doc.get("stats"),
             "source": {"file": entry["file"], "features": total, "sha256": hashlib.sha256(raw).hexdigest()},
             "scheme": {"law": "band = isqrt(key) // S; keys [(b*S)^2, ((b+1)*S)^2)", "S": S, "bands": bands_n},
             "bands": bands}
    (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{lid}: {total} features in {bands_n} bands, largest band {max(x['features'] for x in bands)}")
    return lid


def main():
    m = json.loads((LAYERS / "manifest.json").read_text(encoding="utf-8"))
    tiled = {}
    for l in m["layers"]:
        if (l.get("features") or 0) > TILE_OVER and l.get("file"):
            tiled[tile(l)] = f"tiles/{l['id']}/index.json"
    (OUT / "index.json").write_text(json.dumps({"type": "CodeTileSet", "S": S, "tile_over": TILE_OVER,
                                                "manifest_built_utc": m.get("built_utc"), "layers": tiled}, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
