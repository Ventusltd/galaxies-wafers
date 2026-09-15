#!/usr/bin/env python3
"""Build layers/grid-engine-shell.json: the grid engine's functions with its proven outer shell.

The `engine` layer (build_layers.py) places the Ventus Grid Engine's functions on
the wafer. This layer places the same functions and carries, for each one, what a
consumer of the engine actually meets, read from the engine's own source:

    export_subpath  the package.json "exports" subpath that serves the module, or
                    null with the reason (the package has no "main"; a module
                    with no subpath cannot be imported by name)
    schema          the string in the module's `export const schema = '...'`
                    (or the `const SCHEMA = '...'` it re-exports)
    refuses         the keys of the module's frozen `NOT_COMPUTED`, the things it
                    declines to compute; [] when it has none or it is a string

`stats` carries the verify line printed by `node verify.mjs` in the engine
checkout, verbatim, measured at build time, and the count of modules with and
without an export subpath.

Paths derive from __file__ through build_layers.py (GITHUB is the directory that
holds the repositories). When this checkout lives outside that directory, as a
git worktree does, set GALAXIES_GITHUB to the directory holding globalgrid2050
and ventus-grid-engine. Nothing machine-specific is written into the layer.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_layers as bl  # noqa: E402

GITHUB = Path(os.environ["GALAXIES_GITHUB"]).resolve() if os.environ.get("GALAXIES_GITHUB") else bl.GITHUB
bl.PACK = GITHUB / "globalgrid2050" / "testcode" / "202609142202" / "data"
ENGINE = GITHUB / "ventus-grid-engine"
ENGINE_REPO = "Ventusltd/ventus-grid-engine"
LIVE_ROOT = "https://ventusltd.github.io/ventus-grid-engine/"
LAYER_ID = "grid-engine-shell"


def read_exports() -> tuple[dict, dict]:
    pkg = json.loads((ENGINE / "package.json").read_text(encoding="utf-8"))
    exports = pkg.get("exports") or {}
    by_path = {target[2:] if target.startswith("./") else target: sub for sub, target in exports.items()}
    return pkg, by_path


def read_schema(src: str):
    m = re.search(r"^export\s+const\s+schema\s*=\s*(['\"])(.*?)\1\s*;", src, re.M)
    if m:
        return m.group(2), None
    m = re.search(r"^export\s+const\s+schema\s*=\s*([A-Za-z_$][\w$]*)\s*;", src, re.M)
    if m:
        c = re.search(rf"^(?:export\s+)?const\s+{re.escape(m.group(1))}\s*=\s*(['\"])(.*?)\1\s*;", src, re.M)
        if c:
            return c.group(2), None
        return None, f"schema re-exports {m.group(1)}, whose string literal was not found"
    return None, "the module exports no schema"


def read_refuses(src: str):
    """Top-level keys of `export const NOT_COMPUTED = Object.freeze({...})`."""
    m = re.search(r"^export\s+const\s+NOT_COMPUTED\s*=\s*", src, re.M)
    if not m:
        return [], None
    rest = src[m.end():]
    if not rest.startswith("Object.freeze({"):
        return [], "string" if rest[:1] in "'\"`" else "other"
    i, depth, keys, buf = len("Object.freeze("), 0, [], ""
    quote = None
    while i < len(rest):
        ch = rest[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "'\"`":
            quote = ch
        elif ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
            if depth == 0:
                break
        elif depth == 1:
            buf += ch
            if ch == ",":
                buf = ""
        if depth == 1 and not quote:
            km = re.match(r"^\s*([A-Za-z_$][\w$]*|'[^']*'|\"[^\"]*\")\s*:$", buf)
            if km:
                keys.append(km.group(1).strip("'\""))
                buf = ""
        i += 1
    return keys, "frozen-object"


def defines(src: str, name: str) -> bool:
    n = re.escape(name.split(".")[-1])
    pats = [rf"\bfunction\s*\*?\s*{n}\s*\(", rf"\b(?:const|let|var)\s+{n}\s*=", rf"\bclass\s+{n}\b",
            rf"^\s*(?:async\s+)?{n}\s*\([^)]*\)\s*\{{", rf"^\s*{n}\s*:\s*(?:async\s+)?(?:function|\()",
            rf"\bexport\s+\{{[^}}]*\b{n}\b"]
    return any(re.search(p, src, re.M) for p in pats)


def main() -> int:
    E = bl.ESTATE = bl.load_estate()
    with urllib.request.urlopen(bl.BLOCKS_URL, timeout=60) as r:
        doc = json.loads(r.read().decode("utf-8"))

    pkg, subpath_of = read_exports()
    verify = subprocess.run(["node", "verify.mjs"], cwd=ENGINE, capture_output=True, text=True, encoding="utf-8")
    verify_line = next((ln.strip() for ln in reversed(verify.stdout.splitlines()) if ln.startswith("verify ")),
                       f"verify produced no summary line (exit {verify.returncode})")
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ENGINE, capture_output=True, text=True).stdout.strip()

    by_n = {f["n"]: i for i, f in enumerate(E["families"])}
    modules: dict[str, dict] = {}

    def module(path: str) -> dict:
        if path not in modules:
            p = ENGINE / path
            src = p.read_text(encoding="utf-8") if p.is_file() else ""
            schema, schema_why = read_schema(src) if p.suffix in (".js", ".mjs") else (None, "not a JavaScript module")
            refuses, nc_form = read_refuses(src)
            sub = subpath_of.get(path)
            modules[path] = {
                "src": src, "exists": p.is_file(), "schema": schema, "schema_why": schema_why,
                "refuses": refuses, "not_computed": nc_form, "export_subpath": sub,
                "export_why": None if sub else (
                    f"package.json exports no subpath for {path}; the package has no main, so it cannot be imported by package name"
                    if path.startswith(("engine/", "deeplink/")) else
                    f"{path} is outside engine/ and deeplink/, a source excerpt or page rather than a served module"),
                "sha256": bl.sha256_file(p) if p.is_file() else None,
            }
        return modules[path]

    feats, blocks, unplaced, unresolved = [], set(), 0, 0
    for blk in doc["blocks"]:
        if ENGINE_REPO not in (blk.get("repos") or []):
            continue
        blocks.add(blk["symbol"])
        files = [f for f in (blk.get("files") or []) if f.get("repo") == ENGINE_REPO]
        names = [fn["name"] for fn in blk.get("inside") or []]
        # A function name like `ratio` can be defined in several files a block names; the block's own module
        # is the file that defines the most of the block's functions, so ties resolve to it.
        score = {f["path"]: sum(defines(module(f["path"])["src"], n) for n in names) for f in files}
        files.sort(key=lambda f: (-score[f["path"]], not f["path"].startswith("engine/"), f["path"]))
        for fn in blk.get("inside") or []:
            fi = by_n.get(fn["family"])
            k = bl.first_key(E, fi) if fi is not None else None
            if k is None:
                unplaced += 1
                continue
            hit = next((f for f in files if defines(module(f["path"])["src"], fn["name"])), None)
            props = {"block": blk["symbol"], "title": blk["title"], "function": fn["name"], "family": fn["family"]}
            if hit is None:
                unresolved += 1
                props.update({"module_path": None, "export_subpath": None, "schema": None, "refuses": [],
                              "reason": "not defined in any ventus-grid-engine file this block names; the "
                                        "function lives in another repository the block also claims"})
            else:
                m = module(hit["path"])
                props.update({
                    "module_path": hit["path"], "export_subpath": m["export_subpath"], "schema": m["schema"],
                    "refuses": m["refuses"],
                    "github": f"https://github.com/{ENGINE_REPO}/blob/{hit.get('commit') or head}/{hit['path']}",
                    "live": hit.get("live") or LIVE_ROOT + hit["path"],
                })
                if m["export_why"]:
                    props["export_reason"] = m["export_why"]
                if m["schema_why"]:
                    props["schema_reason"] = m["schema_why"]
                if m["not_computed"] and m["not_computed"] != "frozen-object":
                    props["not_computed_form"] = m["not_computed"]
            feats.append({"type": "Feature", "geometry": {"type": "Point", "key": k}, "properties": props})

    used = sorted(p for p, m in modules.items() if m["exists"] and any(
        f["properties"].get("module_path") == p for f in feats))
    with_sub = [p for p in used if modules[p]["export_subpath"]]
    without_sub = [p for p in used if not modules[p]["export_subpath"]]
    stats = {
        "features": len(feats),
        "verify": verify_line,
        "verify_exit": verify.returncode,
        "engine_commit": head,
        "package_main": pkg.get("main"),
        "exports": list((pkg.get("exports") or {}).keys()),
        "modules": len(used),
        "modules_with_export_subpath": len(with_sub),
        "modules_without_export_subpath": len(without_sub),
        "without_export_subpath": without_sub,
        "modules_with_schema": sum(1 for p in used if modules[p]["schema"]),
        "modules_with_frozen_not_computed": sum(1 for p in used if modules[p]["not_computed"] == "frozen-object"),
        "functions_unresolved_to_engine_file": unresolved,
        "functions_unplaced": unplaced,
        "blocks": sorted(blocks),
    }
    sources = E["sources"] + [{"url": bl.BLOCKS_URL, "generated_utc": doc.get("generated_utc")},
                              {"path": "ventus-grid-engine/package.json", "commit": head,
                               "sha256": bl.sha256_file(ENGINE / "package.json")}]
    sources += [{"path": f"ventus-grid-engine/{p}", "commit": head, "sha256": modules[p]["sha256"]} for p in used]

    path = bl.write_layer(
        {"id": LAYER_ID, "label": "The grid engine, as imported", "group": "THE WORKING MODULES",
         "preload": False, "colour": "#a8f0c6",
         "evidence": "the live register's grid-engine blocks, with each module's export subpath, schema and "
                     "NOT_COMPUTED read from the engine's source",
         "note": "The engine layer again, with its outer shell: which package.json subpath serves each module, the "
                 "schema string it stamps on what it returns, and what it refuses to compute. A module with no "
                 "subpath exists in the repository but a consumer cannot import it by name."},
        feats, stats, sources)

    mpath = bl.OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    d = json.loads(path.read_text(encoding="utf-8"))
    entry = {**d["layer"], "file": f"layers/{path.name}", "bytes": path.stat().st_size,
             "features": len(d["features"]), "sha256": bl.sha256_file(path)}
    ids = [l["id"] for l in manifest["layers"]]
    if LAYER_ID in ids:
        manifest["layers"][ids.index(LAYER_ID)] = entry
    else:
        at = ids.index("engine") + 1 if "engine" in ids else len(ids)
        manifest["layers"].insert(at, entry)
    mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  {LAYER_ID}  {len(feats)} features  {path.stat().st_size:,} bytes")
    print(json.dumps({k: v for k, v in stats.items() if k != "blocks"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
