"""Build a bounded source-evidence report from immutable public inputs.

The source checkout and numbered input cache remain external. Nothing from the
indexed JavaScript is executed. The report contains public identities only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess

from bond_validator import audit


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def build(repo, commit, cache, generated_utc):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("a full source commit is required")
    def read_source(path):
        return subprocess.check_output(["git", "-C", str(repo), "show", f"{commit}:{path}"], timeout=30)
    spec = json.loads(read_source("build/codex-sources.json"))
    sources = []
    def read_input(name):
        pin = spec["inputs"][name]
        data = (cache / name).read_bytes()
        if git_blob(data) != pin["git_blob"]:
            raise ValueError(f"numbered input pin mismatch: {name}")
        sources.append({**pin, "bytes": len(data), "sha256": sha256(data)})
        return data
    def column(name):
        data = read_input(name)
        if len(data) % 4:
            raise ValueError("misaligned numbered input")
        return struct.unpack(f"<{len(data) // 4}I", data)
    issued = column("all-lines.bin")
    family_lines = column("lines.bin")
    families = json.loads(read_input("families.json"))
    manifest_bytes = read_source("layers/manifest.json")
    manifest = json.loads(manifest_bytes)
    layers, raw = {}, {}
    for entry in manifest["layers"]:
        path = entry["file"]
        if not re.fullmatch(r"layers/(?:modules/)?[A-Za-z0-9_.-]+\.json", path):
            raise ValueError("unexpected layer file path")
        data = read_source(path)
        raw[path] = data
        layers[path] = json.loads(data)
    report = audit(manifest, layers, issued, families, family_lines, raw_bytes=raw)
    if any(p["status"] == "FAILED" for p in report["input_checks"]) or report["inputs"]["family_input_issues"]:
        raise ValueError("source input validation failed; no public audit generated")
    report["provenance"] = {"repo": "Ventusltd/galaxies-wafers", "commit": commit,
        "generated_utc": generated_utc, "manifest_sha256": sha256(manifest_bytes),
        "sources": sources, "scope": "pinned snapshot, not the changing live branch"}
    issued_set = set(issued)
    anchors = []
    for entry in manifest["layers"]:
        selected, seen = [], set()
        for feature in layers[entry["file"]].get("features", []):
            geometry = feature.get("geometry", {})
            candidates = [geometry.get("key")] if geometry.get("type") == "Point" else geometry.get("keys", [])
            if not isinstance(candidates, list):
                continue
            for key in candidates:
                if type(key) is int and key in issued_set and key not in seen:
                    selected.append(key); seen.add(key)
                    if len(selected) == 128:
                        break
            if len(selected) == 128:
                break
        anchors.append({"layer_id": entry["id"], "keys": selected})
    report["preview"] = {"anchors": anchors, "max_key": max(issued),
        "sample_limit_per_layer": 128, "rule": "first distinct issued keys in feature order; not all features"}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--galaxy-repo", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--generated-utc", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output exists; choose a new immutable report path")
    result = build(args.galaxy_repo, args.commit, args.input_dir, args.generated_utc)
    data = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as handle:
        handle.write(data)
    print(json.dumps({"schema": result["schema"], "layers": len(result["rows"]), "bytes": len(data), "sha256": sha256(data)}))
