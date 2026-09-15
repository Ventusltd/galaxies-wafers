"""The Bond validator v2: deterministic checks with explicit evidence limits.

Pure stdlib. No network, path discovery, current timestamps, or HTML generation.
Input paths are a CLI concern and never appear in the report. Source prose is
preserved verbatim; callers must supply public, publishable source documents.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from collections.abc import Sequence
import hashlib
import json
from pathlib import Path
import re
import struct

SCHEMA = "bond.v1"
VALIDATOR_VERSION = "2.0.0"
COPYING = "lines carried by 2 to 40 function families and at least 12 characters long"
BLOCKS = "the live block register, each function family a block names, placed at its first line"
STAR = "blocks in the live register with files[].path under testcode/202609142225/, each function family they name placed at its first line"
MODULE = re.compile(r"the live block register: block ([A-Za-z0-9]+) #([0-9]+), ([0-9]+) named families, ([0-9]+) numbered lines, repository (.+)")
ROUTE = "the family's lines in numbering order"
DISCLOSURES = frozenset({"unanchored", "unresolved", "unresolved_families", "why", "live_mismatch", "contract_edge", "not_computed", "NOT_COMPUTED", "limitations"})


def _int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _deviation(field, expected, actual, feature_index=None):
    return {"feature_index": feature_index, "field": field, "expected": expected, "actual": actual}


def _predicate(name, text, checks, total=None):
    """Checks are (passed, deviation); examine all to compute true denominators."""
    checks = list(checks)
    failures = [d for ok, d in checks if not ok]
    checked = len(checks)
    total = checked if total is None else total
    return {"id": name, "text": text,
            "status": "FAILED" if failures else ("NOT EVALUATED" if total > checked else "PASSED"),
            "checked": checked, "total": total, "passed": checked - len(failures),
            "failed": len(failures), "first_deviation": failures[0] if failures else None}


def _one(name, text, ok, field, expected, actual):
    return _predicate(name, text, [(bool(ok), _deviation(field, expected, actual))])


def _neq(row, field, text, reason):
    row["not_evaluated"].append({"field": field, "text": text, "reason": reason})


def _lookup(mapping, entry):
    if mapping is None:
        return None
    return mapping.get(entry.get("file"), mapping.get(entry.get("id")))


def _family_index(families, family_lines):
    issues = []
    if isinstance(families, dict):
        families = families.get("families", list(families.values()))
    if families is not None and not isinstance(families, (list, tuple)):
        return {}, [{"record_index": None, "reason": "family records must be an array or mapping of records"}], 0
    if family_lines is not None and (not isinstance(family_lines, Sequence) or isinstance(family_lines, (str, bytes, bytearray))):
        issues.append({"record_index": None, "reason": "family line array must be an integer sequence"})
        family_lines = None
    records = list(families or [])
    duplicates = {n for n, count in Counter(f.get("n") for f in records if isinstance(f, dict) and _int(f.get("n"))).items() if count > 1}
    index = {}
    for position, f in enumerate(records):
        if not isinstance(f, dict) or not _int(f.get("n")) or f["n"] <= 0 or f["n"] in duplicates:
            issues.append({"record_index": position, "reason": "family identifier missing, invalid, or duplicated"})
            continue
        if isinstance(f.get("lines"), list):
            keys = f["lines"]
        else:
            offset, count = f.get("lineOffset"), f.get("lineCount")
            if not (_int(offset) and _int(count) and offset >= 0 and count >= 0 and family_lines is not None and offset + count <= len(family_lines)):
                issues.append({"record_index": position, "reason": "family slice outside supplied line array"})
                continue
            keys = family_lines[offset:offset + count]
        if not all(_int(k) and 0 < k <= 0xFFFFFFFF for k in keys):
            issues.append({"record_index": position, "reason": "family line array contains invalid key"})
            continue
        index[f["n"]] = list(keys)
    return index, issues, len(records)


def _geometry_keys(g):
    if not isinstance(g, dict):
        return None
    if g.get("type") == "Point" and _int(g.get("key")):
        return [g["key"]]
    if g.get("type") == "LineString" and isinstance(g.get("keys"), list) and len(g["keys"]) >= 2 and all(_int(k) for k in g["keys"]):
        return g["keys"]
    return None


def _block_index(register):
    """Validate optional register shape; never silently pick duplicate symbols."""
    issues, index = [], {}
    if register is None:
        return index, issues
    if not isinstance(register, dict):
        return {}, [{"input": "block_register", "record_index": None, "reason": "register must be an object"}]
    if "blocks" in register:
        records = register["blocks"]
        if not isinstance(records, list):
            return {}, [{"input": "block_register", "record_index": None, "reason": "blocks must be an array"}]
    else:
        records = [{"symbol": symbol, "inside": [{"family": n} for n in ids] if isinstance(ids, list) else None} for symbol, ids in register.items()]
    symbols = Counter(b.get("symbol") for b in records if isinstance(b, dict) and isinstance(b.get("symbol"), str))
    for position, b in enumerate(records):
        reason = None
        if not isinstance(b, dict) or not isinstance(b.get("symbol"), str) or not b["symbol"]:
            reason = "block symbol must be a nonempty string"
        elif symbols[b["symbol"]] != 1:
            reason = "duplicate block symbol is ambiguous"
        elif not isinstance(b.get("inside"), list) or any(not isinstance(x, dict) or not _int(x.get("family")) or x["family"] <= 0 for x in b["inside"]):
            reason = "block membership must contain positive integer family identifiers"
        elif len({x["family"] for x in b["inside"]}) != len(b["inside"]):
            reason = "duplicate family membership has no declared multiplicity contract"
        elif "number" in b and (not _int(b["number"]) or b["number"] <= 0):
            reason = "block number must be a positive integer"
        elif "repos" in b and (not isinstance(b["repos"], list) or any(not isinstance(x, str) or not x for x in b["repos"])):
            reason = "repository list must be an array of nonempty strings"
        if reason:
            issues.append({"input": "block_register", "record_index": position, "reason": reason})
        else:
            index[b["symbol"]] = b
    return index, issues


def _independent_index(independent_lines):
    """Accept JSON-shaped owner/length evidence and canonical line identifiers."""
    if independent_lines is None:
        return {}, []
    if not isinstance(independent_lines, dict):
        return {}, [{"input": "independent_lines", "record_index": None, "reason": "independent lines must be an object"}]
    index, issues, seen = {}, [], set()
    for position, (key, record) in enumerate(independent_lines.items()):
        normalized = key if _int(key) else int(key) if isinstance(key, str) and key.isascii() and key.isdigit() and len(key) <= 10 else None
        reason = None
        if normalized is None or not 0 < normalized <= 0xFFFFFFFF or (isinstance(key, str) and str(normalized) != key):
            reason = "line key must be a positive uint32 integer or canonical decimal string"
        elif normalized in seen:
            reason = "duplicate canonical line key is ambiguous"
            index.pop(normalized, None)
        elif not isinstance(record, dict):
            reason = "independent line record must be an object"
        elif "owners" in record and (not isinstance(record["owners"], list) or any(not _int(n) or n <= 0 for n in record["owners"])):
            reason = "owners must be an array of positive integer family identifiers"
        elif "owners" in record and len(set(record["owners"])) != len(record["owners"]):
            reason = "owner identifiers must be distinct"
        elif "owners_complete" in record and type(record["owners_complete"]) is not bool:
            reason = "owners_complete must be a boolean"
        elif "chars" in record and (not _int(record["chars"]) or record["chars"] < 0):
            reason = "character length must be a nonnegative integer"
        if normalized is not None:
            seen.add(normalized)
        if reason:
            issues.append({"input": "independent_lines", "record_index": position, "reason": reason})
        else:
            index[normalized] = record
    return index, issues


def integrity_checks(entry, doc, raw=None, *, duplicate_id=False):
    """Check manifest facts against parsed content and optional original bytes."""
    features = doc.get("features")
    count = len(features) if isinstance(features, list) else None
    actual_id = doc.get("layer", {}).get("id") if isinstance(doc.get("layer"), dict) else None
    result = [
        _one("manifest.unique_id", "Manifest layer identifier is unique", not duplicate_id, "manifest.id", "unique identifier", "duplicate identifier" if duplicate_id else "unique identifier"),
        _one("manifest.layer_id", "Manifest identifier equals the layer identifier", entry.get("id") == actual_id and isinstance(actual_id, str), "layer.id", entry.get("id"), actual_id),
        _one("manifest.features", "Manifest feature count equals the array length", _int(entry.get("features")) and entry["features"] == count, "manifest.features", count, entry.get("features")),
    ]
    if raw is None:
        for name, text in (("manifest.bytes", "Manifest byte length equals the original file length"), ("manifest.sha256", "Manifest SHA-256 equals the original file digest")):
            result.append(_predicate(name, text, [], 1))
    else:
        digest = hashlib.sha256(raw).hexdigest()
        result.extend([
            _one("manifest.bytes", "Manifest byte length equals the original file length", _int(entry.get("bytes")) and entry["bytes"] == len(raw), "manifest.bytes", len(raw), entry.get("bytes")),
            _one("manifest.sha256", "Manifest SHA-256 equals the original file digest", entry.get("sha256") == digest, "manifest.sha256", digest, entry.get("sha256")),
        ])
        try:
            decoded = json.loads(raw)
            same = decoded == doc
        except (ValueError, UnicodeError):
            same = False
        result.append(_one("manifest.raw_matches_parsed", "Checked bytes decode to the supplied layer document", same, "layer", "same parsed document", "same parsed document" if same else "different or invalid document"))
    return result


def _disclosures(row, doc, features):
    stats = doc.get("stats", {})
    if isinstance(stats, dict):
        for key in sorted(DISCLOSURES & stats.keys()):
            if stats[key] not in (None, "", [], {}):
                row["disclosed"].append({"field": "stats." + key, "value": stats[key], "status": "DISCLOSED"})
    for i, f in enumerate(features):
        props = f.get("properties", {}) if isinstance(f, dict) else {}
        if isinstance(props, dict) and props.get("runtime_replayed") is False:
            row["disclosed"].append({"field": f"features[{i}].properties.runtime_replayed", "value": False, "status": "DISCLOSED"})


def _structural(row, doc, features, issued):
    predicates = row["predicates"]
    predicates.append(_one("collection.format", "Layer is a CodeFeatureCollection on wafer.v1 with a feature array", doc.get("type") == "CodeFeatureCollection" and doc.get("substrate") == "wafer.v1" and isinstance(doc.get("features"), list), "collection", "CodeFeatureCollection / wafer.v1 / array", {"type": doc.get("type"), "substrate": doc.get("substrate"), "feature_array": isinstance(doc.get("features"), list)}))
    stats = doc.get("stats", {})
    stats_count = stats.get("features") if isinstance(stats, dict) else None
    predicates.append(_one("stats.features", "stats.features equals the feature array length", _int(stats_count) and stats_count == len(features), "stats.features", len(features), stats_count))
    geometry_checks, key_checks, feature_checks = [], [], []
    all_keys, valid_features = [], set()
    ids = [f.get("id") for f in features if isinstance(f, dict) and "id" in f]
    id_counts = Counter(json.dumps(v, sort_keys=True) for v in ids)
    id_checks = []
    for i, f in enumerate(features):
        is_feature = isinstance(f, dict) and f.get("type") == "Feature"
        feature_checks.append((is_feature, _deviation("type", "Feature", f.get("type") if isinstance(f, dict) else None, i)))
        g = f.get("geometry") if isinstance(f, dict) else None
        keys = _geometry_keys(g)
        allowed = {"type", "key"} if isinstance(g, dict) and g.get("type") == "Point" else {"type", "keys"}
        valid_geometry = keys is not None and set(g) == allowed
        geometry_checks.append((valid_geometry, _deviation("geometry", "Point {type,key} or LineString {type,keys}; no coordinates", {"type": g.get("type"), "fields": sorted(g.keys())} if isinstance(g, dict) else None, i)))
        if keys is not None:
            all_keys.extend(keys)
            feature_keys_valid = True
            for j, key in enumerate(keys):
                exists = key in issued
                feature_keys_valid &= exists
                field = "geometry.key" if g["type"] == "Point" else f"geometry.keys[{j}]"
                key_checks.append((exists, _deviation(field, "issued line key", key, i)))
            if valid_geometry and is_feature and feature_keys_valid:
                valid_features.add(i)
        if isinstance(f, dict) and "id" in f:
            unique = id_counts[json.dumps(f["id"], sort_keys=True)] == 1
            id_checks.append((unique, _deviation("id", "unique feature identifier", f["id"], i)))
    predicates.extend([
        _predicate("features.type", "Each feature declares type Feature", feature_checks),
        _predicate("geometry.key_only", "Every geometry uses only issued-key geometry fields", geometry_checks),
        _predicate("geometry.issued_keys", "Every named geometry key exists in the supplied numbered database", key_checks),
        _predicate("features.unique_ids", "Present feature identifiers are unique within the layer", id_checks),
    ])
    row["coverage"].update({"features": len(features), "structurally_valid_features": len(valid_features), "key_references": len(all_keys), "issued_key_references": sum(k in issued for k in all_keys), "distinct_keys": len(set(all_keys))})


def _anchors_and_routes(row, features, family_index):
    first_checks, route_checks = [], []
    points, routes, aligned = 0, 0, set()
    for i, f in enumerate(features):
        if not isinstance(f, dict):
            continue
        g, props = f.get("geometry", {}), f.get("properties", {})
        if not isinstance(g, dict) or not isinstance(props, dict):
            continue
        family_field = "family" if "family" in props else "anchor_family" if "anchor_family" in props else None
        if family_field is None:
            continue
        family = props[family_field]
        keys = family_index.get(family) if _int(family) else None
        if g.get("type") == "Point":
            points += 1
            if keys:
                ok = g.get("key") == keys[0]
                first_checks.append((ok, _deviation("geometry.key", keys[0], g.get("key"), i)))
                if ok:
                    aligned.add(i)
            else:
                _neq(row, f"features[{i}].properties.{family_field}", family, "No unique nonempty family line array is available for this exact family identifier.")
        if props.get("route") == ROUTE:
            routes += 1
            if keys is not None:
                actual = g.get("keys")
                ok = g.get("type") == "LineString" and actual == keys
                field = "geometry.keys"
                expected_deviation, actual_deviation = keys, actual
                if isinstance(actual, list):
                    at = next((j for j in range(min(len(actual), len(keys))) if actual[j] != keys[j]), None)
                    if at is not None:
                        field, expected_deviation, actual_deviation = f"geometry.keys[{at}]", keys[at], actual[at]
                    elif len(actual) != len(keys):
                        field, expected_deviation, actual_deviation = "geometry.keys.length", len(keys), len(actual)
                route_checks.append((ok, _deviation(field, expected_deviation, actual_deviation, i)))
                if ok:
                    aligned.add(i)
            else:
                _neq(row, f"features[{i}].properties.route", ROUTE, "No unique family line array is available for the stated family.")
        elif isinstance(props.get("route"), str):
            _neq(row, f"features[{i}].properties.route", props["route"], "Route prose is outside the exact v1 allowlist.")
    if points:
        row["predicates"].append(_predicate("family.first_line", "Point key equals the first entry of its exact family line array", first_checks, points))
    if routes:
        row["predicates"].append(_predicate("family.numbering_order", "Route exactly follows its family's supplied line array, including repeated keys", route_checks, routes))
    row["coverage"].update({"family_point_candidates": points, "family_points_checked": len(first_checks), "family_route_candidates": routes, "family_routes_checked": len(route_checks), "family_aligned_features": len(aligned)})


def _copying(row, features, independent_lines, family_index, owner_index):
    checks = {"owners": [], "chars": [], "incidence": [], "complete_consistency": []}
    totals = len(features)
    incidence_total = 0
    complete_records = 0
    for i, f in enumerate(features):
        g = f.get("geometry", {}) if isinstance(f, dict) else {}
        key = g.get("key") if isinstance(g, dict) else None
        g = g if isinstance(g, dict) else {}
        evidence = independent_lines.get(key, {}) if _int(key) else {}
        owners, chars = evidence.get("owners"), evidence.get("chars")
        observed = owner_index.get(key, set()) if _int(key) else set()
        complete = evidence.get("owners_complete") is True and isinstance(owners, list)
        if isinstance(owners, list):
            incidence_total += len(owners)
            for family in owners:
                if family in family_index:
                    checks["incidence"].append((key in family_index[family], _deviation("geometry.key.owner_membership", "listed owner's family array contains this key", {"family": family, "key": key}, i)))
        if complete:
            complete_records += 1
            # All listed families must have arrays before completeness can pass.
            if all(n in family_index for n in owners):
                consistent = set(owners) == observed
                checks["complete_consistency"].append((consistent, _deviation("geometry.key.complete_owner_index", sorted(observed), owners, i)))
            else:
                consistent = False
        else:
            consistent = False
        if len(observed) > 40:
            checks["owners"].append((False, _deviation("geometry.key.owner_count", "at most 40 distinct families", {"at_least": len(observed)}, i)))
        elif complete and consistent:
            count = len(owners)
            checks["owners"].append((g.get("type") == "Point" and 2 <= count <= 40, _deviation("geometry.key.owner_count", "2 to 40 distinct families in a declared complete, consistent index", count, i)))
        if _int(chars):
            checks["chars"].append((g.get("type") == "Point" and chars >= 12, _deviation("geometry.key.char_length", "at least 12 characters", chars, i)))
    row["predicates"].extend([
        _predicate("copying.owner_membership", "Each available listed owner family independently contains the key", checks["incidence"], incidence_total),
        _predicate("copying.complete_owner_consistency", "Declared complete owner index agrees with all supplied family incidences", checks["complete_consistency"], complete_records),
        _predicate("copying.owner_count", "Owner count is 2 to 40 only with declared completeness and consistent family incidences; over 40 observed owners contradicts the bound", checks["owners"], totals),
        _predicate("copying.minimum_length", "Independent line length is at least 12 characters", checks["chars"], totals),
    ])
    row["coverage"].update({"copying_features": totals, "copying_owner_memberships_checked": len(checks["incidence"]), "copying_owner_memberships_total": incidence_total, "copying_complete_owner_records": complete_records, "copying_consistent_complete_owner_records": sum(ok for ok, _ in checks["complete_consistency"]), "copying_lengths_checked": len(checks["chars"])})
    if not features or len(checks["owners"]) < totals or len(checks["chars"]) < totals:
        _neq(row, "layer.evidence", COPYING, "Copying's upper bound requires owners_complete=true, all listed owner family arrays, and incidence consistency; independent line lengths are also required. A partial owner list establishes no upper bound. Same-feature fields are not proof; empty output establishes no selection completeness.")


def _module(row, doc, features, match, blocks, family_index):
    row["predicates"].append(_predicate("module.rendered_coverage", "Full module representation, including missing or duplicate family Points and routes, has been checked", [], 1))
    _neq(row, "layer.evidence", match.group(), "V2 does not yet establish complete rendered module coverage. Register counts and checked route markers cannot prove the whole module representation.")
    symbol, number, named, lines, repos = match.groups()
    claimed_count, claimed_lines = int(named), int(lines)
    block = blocks.get(symbol)
    if block is None:
        _neq(row, "layer.evidence", match.group(), "Module named-family count, total lines, block number and repository need an independent block register; feature properties and stats alone are insufficient.")
        return
    inside = block.get("inside")
    if not isinstance(inside, list) or any(not isinstance(x, dict) or not _int(x.get("family")) for x in inside):
        _neq(row, "layer.evidence", match.group(), "Independent block membership is missing or malformed.")
        return
    ids = [x["family"] for x in inside]
    p = row["predicates"]
    p.append(_one("module.named_families", "Claimed named-family count equals independent block membership count", claimed_count == len(ids), "layer.evidence.named_families", len(ids), claimed_count))
    stats = doc.get("stats", {})
    if isinstance(stats, dict) and "families" in stats:
        p.append(_one("module.stats_families", "stats.families equals independent block membership count", _int(stats["families"]) and stats["families"] == len(ids), "stats.families", len(ids), stats["families"]))
    if all(n in family_index for n in ids):
        total_lines = sum(len(family_index[n]) for n in ids)
        p.append(_one("module.numbered_lines", "Claimed numbered-line count equals independent family array lengths", total_lines == claimed_lines, "layer.evidence.numbered_lines", total_lines, claimed_lines))
        if isinstance(stats, dict) and "lines" in stats:
            p.append(_one("module.stats_lines", "stats.lines equals independent family array lengths", _int(stats["lines"]) and stats["lines"] == total_lines, "stats.lines", total_lines, stats["lines"]))
    else:
        _neq(row, "layer.evidence", match.group(), "Some registered families have no supplied line array; total numbered-line count is not evaluated.")
    membership = []
    for i, f in enumerate(features):
        props = f.get("properties", {}) if isinstance(f, dict) else {}
        family = props.get("family") if isinstance(props, dict) else None
        membership.append((family in ids, _deviation("properties.family", "a member of the independent block register", family, i)))
    p.append(_predicate("module.feature_membership", "Every feature names an independently registered module family", membership))
    if "number" in block and "repos" in block:
        expected_repos = ", ".join(block["repos"]) or "unstated"
        p.append(_one("module.block_number", "Claimed block number equals independent register", _int(block["number"]) and int(number) == block["number"], "layer.evidence.block_number", block["number"], int(number)))
        p.append(_one("module.repositories", "Claimed repository list equals independent register", repos == expected_repos, "layer.evidence.repositories", expected_repos, repos))
    else:
        _neq(row, "layer.evidence", match.group(), "Supplied block membership does not establish the block number or repository list.")


def audit(manifest, layers, issued_keys, families=None, family_lines=None, *, raw_bytes=None, independent_lines=None, block_register=None):
    """Audit public documents; see API.md for the report and evidence contracts.

    layers/raw_bytes: mappings by manifest file or id. Array indexes are zero
    based. independent_lines must come from independent complete owner/length
    data, never the layer being audited. V2 requires per-record
    owners_complete=true and consistent supplied family arrays to pass an
    owner upper bound. Input objects are not mutated.
    """
    issued_values = list(issued_keys)
    issued = {k for k in issued_values if _int(k) and 0 < k <= 0xFFFFFFFF}
    family_index, family_issues, family_records = _family_index(families, family_lines)
    for family, keys in list(family_index.items()):
        if any(key not in issued for key in keys):
            family_issues.append({"family": family, "reason": "family line array contains an unissued key"})
            del family_index[family]
    blocks, block_issues = _block_index(block_register)
    independent, independent_issues = _independent_index(independent_lines)
    for position, key in enumerate(list(independent)):
        if key not in issued:
            independent_issues.append({"input": "independent_lines", "record_index": position, "reason": "independent line record names an unissued key"})
            del independent[key]
    raw_issues = []
    if raw_bytes is not None and not isinstance(raw_bytes, dict):
        raw_issues.append({"input": "raw_bytes", "record_index": None, "reason": "raw bytes must be a mapping"})
        raw_bytes = None
    elif isinstance(raw_bytes, dict):
        valid_raw = {}
        for position, (key, value) in enumerate(raw_bytes.items()):
            if not isinstance(value, (bytes, bytearray)):
                raw_issues.append({"input": "raw_bytes", "record_index": position, "reason": "raw byte record must contain bytes"})
            else:
                valid_raw[key] = value
        raw_bytes = valid_raw
    owner_index = defaultdict(set)
    for family, keys in family_index.items():
        for key in set(keys):
            owner_index[key].add(family)
    entries = manifest.get("layers", []) if isinstance(manifest, dict) else []
    if not isinstance(entries, list):
        entries = []
    ids = Counter(e.get("id") for e in entries if isinstance(e, dict) and isinstance(e.get("id"), str))
    rows = []
    for position, entry in enumerate(entries):
        if not isinstance(entry, dict):
            entry = {}
        doc = _lookup(layers, entry)
        row = {"manifest_index": position, "layer_id": entry.get("id"), "label": entry.get("label", entry.get("id")), "claim_text": "", "status": "NOT EVALUATED", "predicates": [], "disclosed": [], "not_evaluated": [], "first_deviation": None, "coverage": {}}
        if not isinstance(doc, dict):
            row["predicates"].append(_one("layer.available", "Manifest layer document is available", False, "layer", "parsed layer document", None))
            doc = {}
        metadata = doc.get("layer", {})
        if not isinstance(metadata, dict):
            metadata = {}
        evidence = metadata.get("evidence", "")
        row["claim_text"] = evidence
        row["predicates"].extend(integrity_checks(entry, doc, _lookup(raw_bytes, entry), duplicate_id=ids[entry.get("id")] > 1))
        features = doc.get("features", [])
        if not isinstance(features, list):
            features = []
        _structural(row, doc, features, issued)
        _disclosures(row, doc, features)
        _anchors_and_routes(row, features, family_index)
        match = MODULE.fullmatch(evidence) if isinstance(evidence, str) else None
        if evidence == COPYING:
            _copying(row, features, independent, family_index, owner_index)
        elif match:
            _module(row, doc, features, match, blocks, family_index)
        elif evidence in (BLOCKS, STAR):
            _neq(row, "layer.evidence", evidence, "Exact-family first-line alignment is checked where a family array is supplied; register membership, selection and completeness are not evaluated by this pattern.")
        elif evidence:
            _neq(row, "layer.evidence", evidence, "This evidence text is outside the exact v1 allowlist. Structural or anchor checks do not prove it.")
        else:
            _neq(row, "layer.evidence", evidence, "No evidence statement was supplied.")
        if metadata.get("note"):
            _neq(row, "layer.note", metadata["note"], "Explanatory prose is retained verbatim and is not evaluated by v1.")
        for p in row["predicates"]:
            if p["status"] == "NOT EVALUATED":
                _neq(row, p["id"], p["text"], f"Required independent inputs are available for {p['checked']} of {p['total']} checks.")
        failed = [p for p in row["predicates"] if p["status"] == "FAILED"]
        semantic = [p for p in row["predicates"] if p["id"].startswith(("family.", "module.", "copying.")) and p["checked"]]
        row["status"] = "CONTRADICTED" if failed else "PARTIALLY EVALUATED" if row["not_evaluated"] and semantic else "NOT EVALUATED" if row["not_evaluated"] else "HONOURED"
        row["first_deviation"] = failed[0]["first_deviation"] if failed else None
        row["coverage"].update({"predicates": len(row["predicates"]), "predicates_passed": sum(p["status"] == "PASSED" for p in row["predicates"]), "predicates_failed": len(failed), "checks_evaluated": sum(p["checked"] for p in row["predicates"]), "checks_total": sum(p["total"] for p in row["predicates"]), "not_evaluated_items": len(row["not_evaluated"]), "disclosure_items": len(row["disclosed"])})
        rows.append(row)
    manifest_ok = isinstance(manifest, dict) and manifest.get("substrate") == "wafer.v1" and isinstance(manifest.get("layers"), list)
    input_checks = [
        _one("manifest.format", "Manifest names wafer.v1 and contains a layer array", manifest_ok, "manifest", "wafer.v1 and layer array", "valid" if manifest_ok else "invalid"),
        _one("inputs.issued_keys", "Issued keys are unique positive uint32 integers", len(issued) == len(issued_values), "issued_keys", "unique positive uint32 integers", {"records": len(issued_values), "unique_valid_keys": len(issued)}),
        _one("inputs.family_arrays", "Supplied family arrays have valid unique identifiers, slices and issued keys", not family_issues, "families", "no input issues", {"issue_count": len(family_issues)}),
        _one("inputs.block_register", "Supplied block register has valid shapes and unambiguous identifiers", not block_issues, "block_register", "no input issues", {"issue_count": len(block_issues)}),
        _one("inputs.independent_lines", "Supplied independent line records have valid shapes and identifiers", not independent_issues, "independent_lines", "no input issues", {"issue_count": len(independent_issues)}),
        _one("inputs.raw_bytes", "Supplied original byte records have valid shapes", not raw_issues, "raw_bytes", "no input issues", {"issue_count": len(raw_issues)}),
    ]
    statuses = Counter(r["status"] for r in rows)
    return {"schema": SCHEMA, "validator_version": VALIDATOR_VERSION, "scope": "Explicit allowlisted predicates only; disclosures do not waive contradictions; module rendered coverage remains not evaluated; copying upper bounds require declared completeness and consistent family incidences.", "input_checks": input_checks, "inputs": {"issued_keys": len(issued), "family_records": family_records, "usable_family_arrays": len(family_index), "family_input_issues": family_issues, "optional_input_issues": block_issues + independent_issues + raw_issues}, "coverage": {"manifest_entries": len(entries), "layers_reported": len(rows), "features": sum(r["coverage"]["features"] for r in rows), "key_references": sum(r["coverage"]["key_references"] for r in rows), "checks_evaluated": sum(r["coverage"]["checks_evaluated"] for r in rows), "checks_total": sum(r["coverage"]["checks_total"] for r in rows), "status_counts": {s: statuses[s] for s in ("HONOURED", "CONTRADICTED", "PARTIALLY EVALUATED", "NOT EVALUATED")}}, "rows": rows}


def read_u32(path):
    """Decode the explicitly supplied little-endian uint32 file."""
    raw = Path(path).read_bytes()
    if len(raw) % 4:
        raise ValueError("uint32 data length is not divisible by four")
    return [value[0] for value in struct.iter_unpack("<I", raw)]


def main(argv=None):
    parser = argparse.ArgumentParser(description="The Bond validator v2 offline audit; input paths are explicit and never published.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--layers-map", required=True, help="JSON mapping manifest file/id to an explicit layer JSON path")
    parser.add_argument("--issued-keys", required=True, help="little-endian uint32 binary")
    parser.add_argument("--families")
    parser.add_argument("--family-lines", help="little-endian uint32 binary")
    parser.add_argument("--independent-lines", help="JSON mapping issued key to independent owners and chars")
    parser.add_argument("--block-register", help="independent register or block-to-family-ID mapping")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if Path(args.output).exists():
        parser.exit(2, "Output already exists; supply a new output filename.\n")
    def read_json(path):
        return json.loads(Path(path).read_text(encoding="utf-8-sig")) if path else None
    try:
        mapping = read_json(args.layers_map)
        raw = {key: Path(path).read_bytes() for key, path in mapping.items()}
        layers = {key: json.loads(value) for key, value in raw.items()}
        report = audit(read_json(args.manifest), layers, read_u32(args.issued_keys), read_json(args.families), read_u32(args.family_lines) if args.family_lines else None, raw_bytes=raw, independent_lines=read_json(args.independent_lines), block_register=read_json(args.block_register))
        with Path(args.output).open("x", encoding="utf-8") as output:
            output.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    except (OSError, ValueError, TypeError, KeyError):
        parser.exit(2, "Input could not be decoded or output could not be written. Check the explicit input mapping and formats.\n")
    return 1 if any(p["status"] == "FAILED" for p in report["input_checks"]) or any(r["status"] == "CONTRADICTED" for r in report["rows"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
