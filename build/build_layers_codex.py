#!/usr/bin/env python3
"""Build additional CodeFeatureCollections without changing the substrate.

Inputs are pinned public Git blobs, cached outside this repository. This tool
never executes indexed source code. Source-place matches are exact; a family
name alone is not evidence of a source occurrence. Missing anchors are counted
and explained, never replaced with block numbers or invented line keys.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYER_IDS = ("sld-sandbox", "sld-requires", "pipeline-news", "deeplink", "periodic-table")
MAX_BYTES = 32 * 1024 * 1024
BOUNDARY = (
    "Physics drawn by computers, not an engineering design or certification. "
    "Project policy: real designs above 100 kW require study and approval by a "
    "Chartered Electrical Engineer with 40 years of proven power-systems experience, "
    "manufacturer supervision, applicable standards and finite-element analysis "
    "where required. This surface is not that study; lower-power work is not "
    "certified by this surface either."
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def integer(value):
    return type(value) is int and 0 < value <= 0xFFFFFFFF


class Inputs:
    def __init__(self, spec, directory, fetch=False):
        self.spec, self.directory, self.fetch = spec, directory, fetch
        self.used = {}

    def read(self, name):
        source = self.spec["inputs"][name]
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
            raise ValueError("input name must be a basename")
        if not re.fullmatch(r"Ventusltd/[a-zA-Z0-9_.-]+", source["repo"]):
            raise ValueError("unapproved source owner")
        if not re.fullmatch(r"[0-9a-f]{40}", source["commit"]):
            raise ValueError("source commit must be full length")
        if not re.fullmatch(r"[0-9a-f]{40}", source["git_blob"]):
            raise ValueError("source Git blob must be pinned")
        parts = source["path"].split("/")
        if any(p in ("", ".", "..") for p in parts) or any(c in source["path"] for c in "\\?#"):
            raise ValueError("invalid public source path")
        path = self.directory / name
        url = f"https://raw.githubusercontent.com/{source['repo']}/{source['commit']}/{source['path']}"
        if not path.exists():
            if not self.fetch:
                raise ValueError(f"missing pinned input: {name}; use --fetch")
            self.directory.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(MAX_BYTES + 1)
            self.check(name, source, data)
            with path.open("xb") as handle:
                handle.write(data)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
            raise ValueError(f"invalid input file: {name}")
        data = path.read_bytes()
        self.check(name, source, data)
        self.used[name] = {**source, "sha256": digest(data), "bytes": len(data)}
        return data

    @staticmethod
    def check(name, source, data):
        if len(data) > MAX_BYTES or git_blob(data) != source["git_blob"]:
            raise ValueError(f"pinned Git blob mismatch: {name}")

    def json(self, name):
        return json.loads(self.read(name))

    def text(self, name):
        return self.read(name).decode("utf-8")


class Estate:
    def __init__(self, keys, families, lines):
        if len(keys) != len(set(keys)) or any(not integer(k) for k in keys):
            raise ValueError("issued keys must be unique positive uint32 values")
        self.keys = set(keys)
        self.lines = lines
        self.families = {}
        for family in families:
            n, offset, count = family["n"], family["lineOffset"], family["lineCount"]
            if not integer(n) or n in self.families:
                raise ValueError("family IDs must be unique")
            if type(offset) is not int or type(count) is not int or offset < 0 or count < 0 or offset + count > len(lines):
                raise ValueError("family line span is outside the pack")
            if any(k not in self.keys for k in lines[offset:offset + count]):
                raise ValueError("family references an unissued line key")
            self.families[n] = family

    def anchor(self, family_id):
        f = self.families.get(family_id)
        if not f:
            return None, "family-not-in-numbered-pack"
        if not f["lineCount"]:
            return None, "family-has-no-numbered-line"
        return self.lines[f["lineOffset"]], None


def u32(data):
    if len(data) % 4:
        raise ValueError("unaligned uint32 input")
    return list(struct.unpack(f"<{len(data) // 4}I", data))


def point(key, properties):
    return {"type": "Feature", "geometry": {"type": "Point", "key": key}, "properties": properties}


def edge(a, b, properties):
    return {"type": "Feature", "geometry": {"type": "LineString", "keys": [a, b]}, "properties": properties}


def same_place(place, source):
    return all(place.get(k) == source[k] for k in ("repo", "commit", "path"))


def exact_occurrences(records, source):
    return [(record, place) for record in records.values() for place in record.get("places", [])
            if same_place(place, source)]


def bridge_records(records, reference, target, reference_text, target_text, family_ids=None):
    """Add a derived place only after an indexed full span matches uniquely.

    This proves an exact source span, not equivalent surrounding globals,
    whole releases, runtime behaviour or standalone executability.
    """
    reference_lines = reference_text.splitlines(keepends=True)
    pending = []
    for record, place in exact_occurrences(records, reference):
        if family_ids is not None and record["n"] not in family_ids:
            continue
        first, last = place.get("first"), place.get("last")
        if not integer(first) or not integer(last) or last < first or last > len(reference_lines):
            continue
        fragment = "".join(reference_lines[first - 1:last])
        if not fragment.strip() or target_text.count(fragment) != 1:
            continue
        offset = target_text.index(fragment)
        if offset and target_text[offset - 1] != "\n":
            continue
        current_first = target_text[:offset].count("\n") + 1
        current_last = current_first + len(fragment.splitlines()) - 1
        derived = {k: target[k] for k in ("repo", "commit", "path")}
        derived.update(first=current_first, last=current_last, name=place["name"],
            source_equivalence={"method": "unique exact indexed full span; no normalization",
                "sha256": digest(fragment.encode("utf-8")), "bytes": len(fragment.encode("utf-8")),
                "indexed_place": place})
        pending.append((record, derived))
    for record, derived in pending:
        if not any(same_place(p, target) and p.get("first") == derived["first"] for p in record["places"]):
            record["places"].append(derived)
    return len(pending)


def source_anchor(estate, records, source, line=None):
    choices = []
    for record, place in exact_occurrences(records, source):
        first, last = place.get("first"), place.get("last")
        if not integer(first) or not integer(last) or last < first:
            continue
        if line is not None and not first <= line <= last:
            continue
        key, why = estate.anchor(record["n"])
        if why or not record.get("lines") or key != record["lines"][0]:
            continue
        rank = last - first if line is not None else first
        choices.append((rank, record["n"], key, place))
    if not choices:
        return None, "no-exact-source-place-and-pack-anchor-in-inspected-index"
    best = min(c[0] for c in choices)
    choices = {(n, key): place for rank, n, key, place in choices if rank == best}
    if len(choices) != 1:
        return None, "ambiguous-source-family-anchor"
    (n, key), place = next(iter(choices.items()))
    return {"family": n, "key": key, "place": place}, None


def footprint(estate, membership):
    features, missing = [], []
    if len(membership) != len(set(membership)) or any(not integer(n) for n in membership):
        raise ValueError("invalid block family membership")
    for n in membership:
        key, why = estate.anchor(n)
        if why:
            missing.append({"family": n, "reason": why})
        else:
            features.append(point(key, {"block": "Ss", "family": n,
                "function": estate.families[n]["name"], "evidence": "registered family membership",
                "anchor": "first numbered line of family; not a standalone callable export"}))
    return features, {"registered_families": len(membership), "unanchored": missing,
        "scope": "aggregated Ss families across the register; not a current-cartridge function count"}


def requires_rules(text):
    found = []
    pattern = re.compile(r"throw\s+new\s+Error\(\s*(['\"])([^'\"\n]+)\1\s*\)")
    for match in pattern.finditer(text):
        message = match[2]
        dep = re.search(r"requires the ([\w-]+) module", message)
        if dep:
            required = dep[1]
        elif "sizing-arithmetic module is not composed" in message:
            required = "sizing-arithmetic"
        elif "declared-connections module is not composed" in message:
            required = "declared-connections"
        elif "engine init function is unavailable" in message:
            required = "initVentusMap"
        else:
            continue
        found.append({"line": text[:match.start()].count("\n") + 1,
                      "requires": required, "message": message})
    return found


def requires_layer(estate, records, text, source, targets):
    features, unresolved = [], []
    rules = requires_rules(text)
    for rule in rules:
        left, left_why = source_anchor(estate, records, source, rule["line"])
        target = targets.get(rule["requires"])
        right, right_why = source_anchor(estate, records, target) if target else (None, "target-source-not-pinned")
        if left_why or right_why:
            unresolved.append({**rule, "from_reason": left_why, "to_reason": right_why,
                               "evidence": "read from source"})
            continue
        features.append(edge(left["key"], right["key"], {**rule, "evidence": "read from source",
            "from_family": left["family"], "to_family": right["family"],
            "from_source": left["place"], "to_source": right["place"],
            "runtime_replayed": False}))
    return features, {"source_guards": len(rules), "unanchored": unresolved,
        "index_limit": "only pinned supplied source-place buckets searched; published place lists are truncated",
        "scope": "literal source guards, not a complete runtime dependency proof"}


def url_readers(estate, records, text, source, parameters):
    features, seen, matched = [], set(), set()
    accesses = []
    for m in re.finditer(r"\.(?:get|has|getAll)\(\s*(['\"])([\w-]+)\1\s*\)", text):
        if m[2] in parameters:
            accesses.append((text[:m.start()].count("\n") + 1, m[2]))
    for record, place in exact_occurrences(records, source):
        first, last = place.get("first", 0), place.get("last", -1)
        params = sorted({param for line, param in accesses if first <= line <= last})
        if not params or record["n"] in seen:
            continue
        key, why = estate.anchor(record["n"])
        if why or not record.get("lines") or record["lines"][0] != key:
            continue
        seen.add(record["n"]); matched.update(params)
        features.append(point(key, {"family": record["n"], "function": place["name"],
            "shell": {"query_parameters": params}, "source": place,
            "evidence": "exact indexed source span containing literal query-reader candidates",
            "runtime_replayed": False}))
    return features, {"parameters_requested": parameters, "parameters_anchored": sorted(matched),
        "parameters_without_anchor": sorted(set(parameters) - matched),
        "literal_accesses": len(accesses),
        "reason": "exact source-place matches required; names alone and top-level unindexed code are not anchored",
        "scope": "static source span, not a browser delivery or every runtime URL path"}


def receiver_layer(estate, records, text, source, membership):
    contract = re.search(r"const CONTRACT_PARAMS\s*=\s*Object\.freeze\((\[[^\]]*\])\)", text)
    if not contract:
        raise ValueError("receiver contract parameter list not found")
    parameters = json.loads(contract[1])
    features, seen, unanchored = [], set(), []
    for record, place in exact_occurrences(records, source):
        n = record["n"]
        if n not in membership or n in seen:
            continue
        key, why = estate.anchor(n)
        if why or not record.get("lines") or record["lines"][0] != key:
            continue
        seen.add(n)
        features.append(point(key, {"family": n, "function": place["name"], "source": place,
            "module_contract_parameters": parameters, "evidence": "read from source",
            "scope": "sender-side receiver selection and deep-link construction; not the Atlas receiver runtime",
            "runtime_replayed": False}))
    for n in membership:
        if n not in seen:
            unanchored.append({"family": n, "reason": "no-exact-source-equivalence-and-pack-anchor"})
    return features, {"registered_families": len(membership), "unanchored": unanchored,
        "contract_parameters": parameters,
        "contract_edge": {"status": "unanchored", "reason": "actual Atlas receiver family is not established; no sender-to-receiver edge invented"},
        "scope": "the named source file builds the link on the sender side; filename alone does not identify the receiver implementation"}


def validate_layer(doc, issued):
    if doc.get("type") != "CodeFeatureCollection" or doc.get("substrate") != "wafer.v1":
        raise ValueError("invalid layer envelope")
    if doc["layer"].get("id") not in LAYER_IDS or doc["layer"].get("preload") is not False:
        raise ValueError("invalid layer identity or lazy-load policy")
    if doc["stats"].get("features") != len(doc["features"]):
        raise ValueError("feature count mismatch")
    for feature in doc["features"]:
        if set(feature) != {"type", "geometry", "properties"} or feature["type"] != "Feature":
            raise ValueError("invalid feature")
        g = feature["geometry"]
        if g.get("type") == "Point" and set(g) == {"type", "key"}:
            keys = [g["key"]]
        elif g.get("type") == "LineString" and set(g) == {"type", "keys"} and isinstance(g["keys"], list) and len(g["keys"]) >= 2:
            keys = g["keys"]
        else:
            raise ValueError("geometry must contain keys only")
        if any(not integer(k) or k not in issued for k in keys):
            raise ValueError("geometry names an unissued key")
    canonical(doc)  # also refuses non-finite output


def make_layer(layer_id, label, features, stats, sources, built_utc):
    stats = {**stats, "features": len(features),
             "distinct_keys": len({k for f in features for k in
                 ([f["geometry"]["key"]] if f["geometry"]["type"] == "Point" else f["geometry"]["keys"])})}
    summaries = {
        "sld-sandbox": f"{len(features)} registered family features on {stats['distinct_keys']} distinct first-line keys; aggregated across source versions, not one cartridge.",
        "sld-requires": f"{stats.get('source_guards', 0)} source guards inspected; {len(features)} dependency lines anchored. Missing requiring-family anchors are retained in the source findings, not invented.",
        "pipeline-news": f"{len(features)} exact source-matched URL reader families; only the parameters read by each matched span are attached.",
        "deeplink": f"{len(features)} source-matched sender-side helper families; parameter names describe the module contract. The actual Atlas receiver endpoint remains unanchored, so no connecting line is claimed.",
        "periodic-table": "Query-reader source is identified, but no exact numbered family anchor is established in the inspected index; this layer deliberately has no marks." if not features else f"{len(features)} exact source-matched table reader families.",
    }
    return {"type": "CodeFeatureCollection", "substrate": "wafer.v1",
        "layer": {"id": layer_id, "label": label, "group": "SOURCE-CONFIRMED INTERFACES", "preload": False,
            "colour": "#5ec8f2", "draws": "lines" if layer_id == "sld-requires" else "points",
            "evidence": summaries[layer_id] + " " + BOUNDARY,
            "note": BOUNDARY},
        "provenance": {"built_utc": built_utc, "sources": sources}, "stats": stats, "features": features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--fetch", action="store_true", help="fetch only absent, pinned public inputs")
    parser.add_argument("--output-dir", required=True, type=Path, help="new directory; never replaces existing output")
    args = parser.parse_args()
    if args.input_dir.resolve().is_relative_to(ROOT):
        parser.error("keep the public input pack outside this repository")
    if args.output_dir.exists():
        parser.error("output directory already exists; use a fresh candidate directory")
    spec = json.loads((ROOT / "build" / "codex-sources.json").read_bytes())
    inputs = Inputs(spec, args.input_dir, args.fetch)
    estate = Estate(u32(inputs.read("all-lines.bin")), inputs.json("families.json"), u32(inputs.read("lines.bin")))
    meta = inputs.json("all-lines.meta.json")
    if meta["lines"] != len(estate.keys):
        raise ValueError("pack metadata count mismatch")
    blocks = inputs.json("block-families.json")
    records = {}
    for name in spec["family_buckets"]:
        for key, record in inputs.json(name).items():
            if int(key) != record["n"] or record["n"] in records:
                raise ValueError("duplicate or mismatched source-family record")
            records[record["n"]] = record
    for bridge in spec.get("source_bridges", []):
        reference, target = bridge["reference"], bridge["target"]
        bridge_records(records, spec["inputs"][reference], spec["inputs"][target],
                       inputs.text(reference), inputs.text(target), bridge.get("families"))
    source = spec["inputs"]["sld-source.js"]
    sld_text = inputs.text("sld-source.js")
    targets = {key: spec["inputs"][name] for key, name in spec["requirement_targets"].items()}
    for name in spec["requirement_targets"].values():
        inputs.read(name)
    builds = [("sld-sandbox", "SLD function families", *footprint(estate, blocks["Ss"])),
              ("sld-requires", "SLD source requirements", *requires_layer(estate, records, sld_text, source, targets))]
    for layer_id, label, name, params in spec["reader_layers"]:
        if layer_id == "deeplink":
            result = receiver_layer(estate, records, inputs.text(name), spec["inputs"][name], blocks["x792"])
        else:
            result = url_readers(estate, records, inputs.text(name), spec["inputs"][name], params)
        builds.append((layer_id, label, *result))
    if tuple(b[0] for b in builds) != LAYER_IDS:
        raise ValueError("candidate layers differ from the assigned set")
    sources = [inputs.used[name] for name in sorted(inputs.used)]
    docs = [make_layer(layer_id, label, features, stats, sources, spec["built_utc"])
            for layer_id, label, features, stats in builds]
    for doc in docs:
        validate_layer(doc, estate.keys)
    args.output_dir.mkdir(parents=True)
    entries = []
    for doc in docs:
        data = canonical(doc)
        name = doc["layer"]["id"] + ".json"
        (args.output_dir / name).write_bytes(data)
        entries.append({**doc["layer"], "file": "layers/" + name, "bytes": len(data),
                        "features": len(doc["features"]), "sha256": digest(data)})
    (args.output_dir / "manifest-entries.json").write_bytes(canonical({"substrate": "wafer.v1", "layers": entries}))
    print(json.dumps({"status": "candidate", "layers": [{"id": d["layer"]["id"], "stats": d["stats"]} for d in docs]}))


if __name__ == "__main__":
    main()
