#!/usr/bin/env python3
"""Tile a layer by radius band, so a phone loads only the part of the wafer it looks at.

WHY A BAND IS A KEY RANGE. The wafer's frozen law places every key at radius
r = sqrt(key). A ring of radius [b*S, (b+1)*S) is therefore exactly the key range
[(b*S)^2, ((b+1)*S)^2), and a key's band is isqrt(key) // S in integer arithmetic,
with no floating point and no coordinates. Tiling cannot move anything.

THE BAND WIDTH. The numbering runs to key 342,795, radius ~585.5. S = 25 gives 24
bands (0..23) covering radius 0..600.

OUTPUT. For layer <id>:
  layers/tiles/<id>/<band>.json   a CodeFeatureCollection with the source's layer
                                  and provenance blocks plus tile {band, key_min, key_max}
                                  (key_max exclusive)
  layers/tiles/<id>/index.json    every band with feature count, bytes and sha256

A Point is banded by its key; a LineString by its first key (its anchor), so each
feature lives in exactly one tile.

    python build/tile_layer.py            # tiles copying
    python build/tile_layer.py engine     # tiles any layer in layers/
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
LAYERS = REPO / "layers"

MAX_KEY = 342_795
S = 25
BANDS = math.isqrt(MAX_KEY) // S + 1   # 24


def anchor(f: dict) -> int:
    g = f["geometry"]
    return g["key"] if g["type"] == "Point" else g["keys"][0]


def band_of(key: int) -> int:
    return math.isqrt(key) // S


def tile(layer_id: str) -> dict:
    src = LAYERS / f"{layer_id}.json"
    doc = json.loads(src.read_text(encoding="utf-8"))
    out = LAYERS / "tiles" / layer_id
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()

    buckets: list[list] = [[] for _ in range(BANDS)]
    for f in doc["features"]:
        k = anchor(f)
        b = band_of(k)
        if not 0 <= b < BANDS:
            raise SystemExit(f"key {k} lies beyond band {BANDS - 1}; raise MAX_KEY")
        buckets[b].append(f)

    bands = []
    outside = 0
    for b, feats in enumerate(buckets):
        key_min, key_max = (b * S) ** 2, ((b + 1) * S) ** 2
        outside += sum(1 for f in feats if not key_min <= anchor(f) < key_max)
        t = {
            "type": "CodeFeatureCollection",
            "substrate": doc.get("substrate"),
            "layer": doc["layer"],
            "provenance": doc["provenance"],
            "tile": {"band": b, "key_min": key_min, "key_max": key_max},
            "features": feats,
        }
        data = json.dumps(t, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        p = out / f"{b}.json"
        p.write_bytes(data)
        bands.append({"band": b, "key_min": key_min, "key_max": key_max,
                      "file": f"layers/tiles/{layer_id}/{b}.json", "features": len(feats),
                      "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    total = sum(x["features"] for x in bands)
    source_n = len(doc["features"])
    print(f"ASSERT sum of tile features {total} == source features {source_n}: {total == source_n}")
    print(f"ASSERT keys outside their band: {outside}")
    assert total == source_n, "tiles lost or duplicated features"
    assert outside == 0, "a key fell outside its band"

    index = {
        "type": "CodeTileIndex",
        "substrate": doc.get("substrate"),
        "layer": doc["layer"],
        "provenance": doc["provenance"],
        "source": {"file": f"layers/{layer_id}.json", "features": source_n,
                   "sha256": hashlib.sha256(src.read_bytes()).hexdigest()},
        "scheme": {"law": "band = isqrt(key) // S; keys [(b*S)^2, ((b+1)*S)^2)", "S": S, "bands": BANDS},
        "bands": bands,
    }
    (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    sizes = [x["bytes"] for x in bands]
    print(f"{layer_id}: {BANDS} bands, S={S}, bytes min {min(sizes)} max {max(sizes)} total {sum(sizes)}")
    for x in bands:
        print(f"  band {x['band']:2d} keys [{x['key_min']:6d},{x['key_max']:6d})  {x['features']:5d} features  {x['bytes']:7d} B")
    return index


def mark_manifest(layer_id: str) -> None:
    mp = LAYERS / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    for l in m["layers"]:
        if l["id"] == layer_id:
            l["tiles"] = f"layers/tiles/{layer_id}/index.json"
    mp.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    ids = sys.argv[1:] or ["copying"]
    for i in ids:
        tile(i)
        mark_manifest(i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
