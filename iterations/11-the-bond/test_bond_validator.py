import copy
import hashlib
import json
from pathlib import Path
import unittest

from bond_validator import audit, main, COPYING, BLOCKS, ROUTE


def feature(key=101, family=9):
    return {"type": "Feature", "geometry": {"type": "Point", "key": key}, "properties": {"family": family}}


def fixture(features=None, evidence=BLOCKS, note=""):
    features = [feature()] if features is None else features
    doc = {"type": "CodeFeatureCollection", "substrate": "wafer.v1", "layer": {"id": "example", "evidence": evidence, "note": note}, "stats": {"features": len(features)}, "features": features}
    return doc


def run(doc, *, manifest_edit=None, families=None, keys=None, independent_lines=None, block_register=None):
    raw = json.dumps(doc, separators=(",", ":")).encode()
    entry = {"id": "example", "file": "layers/example.json", "features": len(doc["features"]), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    manifest = {"substrate": "wafer.v1", "layers": [entry]}
    if manifest_edit:
        manifest_edit(manifest)
    return audit(manifest, {"example": doc}, [101, 102, 103] if keys is None else keys, [{"n": 9, "lineOffset": 0, "lineCount": 3}] if families is None else families, [101, 102, 103], raw_bytes={"example": raw}, independent_lines=independent_lines, block_register=block_register)


def predicate(report, name):
    return next(p for p in report["rows"][0]["predicates"] if p["id"] == name)


class BondTests(unittest.TestCase):
    def test_known_valid_point(self):
        report = run(fixture())
        self.assertEqual(predicate(report, "geometry.issued_keys")["status"], "PASSED")
        self.assertEqual(predicate(report, "family.first_line")["status"], "PASSED")
        self.assertEqual(report["rows"][0]["coverage"]["features"], 1)
        self.assertEqual(report["rows"][0]["status"], "PARTIALLY EVALUATED")

    def test_unissued_key(self):
        report = run(fixture([feature(999)]))
        p = predicate(report, "geometry.issued_keys")
        self.assertEqual(p["status"], "FAILED")
        self.assertEqual(p["first_deviation"]["feature_index"], 0)
        self.assertEqual(p["first_deviation"]["field"], "geometry.key")
        self.assertEqual(report["rows"][0]["status"], "CONTRADICTED")

    def test_family_number_is_not_key(self):
        report = run(fixture([feature(9)]))
        self.assertEqual(predicate(report, "geometry.issued_keys")["failed"], 1)
        self.assertEqual(predicate(report, "family.first_line")["failed"], 1)

    def test_family_number_can_be_issued_but_wrong_anchor(self):
        report = run(fixture([feature(9)]), keys=[9, 101, 102, 103])
        self.assertEqual(predicate(report, "geometry.issued_keys")["status"], "PASSED")
        self.assertEqual(predicate(report, "family.first_line")["status"], "FAILED")

    def test_first_line_mismatch(self):
        report = run(fixture([feature(102)]))
        self.assertEqual(predicate(report, "family.first_line")["first_deviation"]["expected"], 101)

    def test_anchor_family(self):
        f = feature()
        f["properties"] = {"anchor_family": 9}
        self.assertEqual(predicate(run(fixture([f])), "family.first_line")["status"], "PASSED")

    def test_coordinates_forbidden_even_with_valid_key(self):
        f = feature()
        f["geometry"]["coordinates"] = [0, 0]
        report = run(fixture([f]))
        self.assertEqual(predicate(report, "geometry.key_only")["status"], "FAILED")
        self.assertEqual(report["rows"][0]["coverage"]["structurally_valid_features"], 0)

    def test_stale_manifest_count_hash_bytes(self):
        def corrupt(m):
            m["layers"][0].update(features=2, bytes=1, sha256="0" * 64)
        report = run(fixture(), manifest_edit=corrupt)
        for name in ("manifest.features", "manifest.bytes", "manifest.sha256"):
            self.assertEqual(predicate(report, name)["status"], "FAILED")

    def test_duplicate_manifest_ids(self):
        def duplicate(m):
            m["layers"].append(copy.deepcopy(m["layers"][0]))
        report = run(fixture(), manifest_edit=duplicate)
        self.assertEqual(len(report["rows"]), 2)
        self.assertTrue(all(r["status"] == "CONTRADICTED" for r in report["rows"]))

    def test_duplicate_feature_ids(self):
        f, g = feature(), feature(102)
        f["id"] = g["id"] = "a"
        report = run(fixture([f, g]))
        self.assertEqual(predicate(report, "features.unique_ids")["failed"], 2)

    def test_honest_empty_disclosed(self):
        doc = fixture([], evidence="The register has no exact anchor; no marks are placed.")
        doc["stats"]["why"] = "No exact numbered anchor exists in the supplied register."
        report = run(doc)
        row = report["rows"][0]
        self.assertEqual(row["coverage"]["features"], 0)
        self.assertEqual(row["status"], "NOT EVALUATED")
        self.assertEqual(row["disclosed"][0]["status"], "DISCLOSED")
        self.assertEqual(predicate(report, "stats.features")["status"], "PASSED")

    def test_disclosure_does_not_waive_bad_key(self):
        doc = fixture([feature(999)])
        doc["stats"]["unanchored"] = [{"reason": "The target is unknown"}]
        report = run(doc)
        self.assertEqual(report["rows"][0]["status"], "CONTRADICTED")
        self.assertEqual(len(report["rows"][0]["disclosed"]), 1)

    def test_unresolved_disclosure_exact_field(self):
        doc = fixture()
        doc["stats"]["unresolved"] = [12, 13]
        self.assertEqual(run(doc)["rows"][0]["disclosed"][0]["field"], "stats.unresolved")

    def test_issued_keys_reject_non_uint32_values(self):
        report = run(fixture(), keys=[101, 102, 103, 0x100000000, True, -1])
        self.assertEqual(report["input_checks"][1]["status"], "FAILED")
        self.assertEqual(report["inputs"]["issued_keys"], 3)

    def test_cli_refuses_existing_output_before_reading_inputs(self):
        existing = Path(__file__)
        before = existing.read_bytes()
        with self.assertRaises(SystemExit) as result:
            main(["--manifest", "unused", "--layers-map", "unused", "--issued-keys", "unused", "--output", str(existing)])
        self.assertEqual(result.exception.code, 2)
        self.assertEqual(existing.read_bytes(), before)

    def test_unsupported_prose_is_verbatim_and_not_honoured(self):
        prose = "Every function is safe and all outcomes have been established."
        report = run(fixture(evidence=prose))
        row = report["rows"][0]
        self.assertNotEqual(row["status"], "HONOURED")
        self.assertEqual(row["not_evaluated"][0]["text"], prose)

    def test_copying_does_not_trust_same_feature_fields(self):
        f = feature()
        f["properties"] = {"families": 2, "chars": 30}
        report = run(fixture([f], COPYING))
        self.assertEqual(predicate(report, "copying.owner_count")["status"], "NOT EVALUATED")
        self.assertEqual(predicate(report, "copying.minimum_length")["status"], "NOT EVALUATED")

    def test_copying_independent_both_predicates(self):
        f = feature()
        f["properties"] = {"families": 2, "chars": 30}
        report = run(fixture([f], COPYING), independent_lines={101: {"owners": [9, 10], "owners_complete": True, "chars": 15}}, families=[{"n": 9, "lines": [101, 102, 103]}, {"n": 10, "lines": [101]}])
        self.assertEqual(report["rows"][0]["status"], "HONOURED")
        self.assertNotIn("UNDERCLAIMED", json.dumps(report))

    def test_copying_independent_detects_short_and_one_owner(self):
        report = run(fixture(evidence=COPYING), independent_lines={101: {"owners": [9], "owners_complete": True, "chars": 4}})
        self.assertEqual(predicate(report, "copying.owner_count")["status"], "FAILED")
        self.assertEqual(predicate(report, "copying.minimum_length")["status"], "FAILED")

    def test_route_numbering_array_not_numeric_sort(self):
        route = {"type": "Feature", "geometry": {"type": "LineString", "keys": [103, 101, 103]}, "properties": {"family": 9, "route": ROUTE}}
        report = run(fixture([route]), families=[{"n": 9, "lines": [103, 101, 103]}])
        self.assertEqual(predicate(report, "family.numbering_order")["status"], "PASSED")
        route["geometry"]["keys"] = [101, 103, 103]
        p = predicate(run(fixture([route]), families=[{"n": 9, "lines": [103, 101, 103]}]), "family.numbering_order")
        self.assertEqual(p["status"], "FAILED")
        self.assertEqual(p["first_deviation"]["field"], "geometry.keys[0]")

    def test_module_counts_need_independent_register(self):
        text = "the live block register: block Ga #14, 1 named families, 3 numbered lines, repository Public/repo"
        doc = fixture(evidence=text)
        doc["stats"].update(families=1, lines=3)
        report = run(doc)
        self.assertTrue(any("independent block register" in x["reason"] for x in report["rows"][0]["not_evaluated"]))
        independent = {"blocks": [{"symbol": "Ga", "number": 14, "inside": [{"family": 9}], "repos": ["Public/repo"]}]}
        report = run(doc, block_register=independent)
        self.assertEqual(predicate(report, "module.named_families")["status"], "PASSED")
        self.assertEqual(predicate(report, "module.numbered_lines")["status"], "PASSED")

    def test_unknown_family_is_unevaluated(self):
        report = run(fixture([feature(family=10)]))
        p = predicate(report, "family.first_line")
        self.assertEqual((p["checked"], p["total"], p["status"]), (0, 1, "NOT EVALUATED"))

    def test_duplicate_family_metadata_is_not_resolved_arbitrarily(self):
        report = run(fixture(), families=[{"n": 9, "lines": [101]}, {"n": 9, "lines": [102]}])
        self.assertEqual(predicate(report, "family.first_line")["status"], "NOT EVALUATED")
        self.assertEqual(len(report["inputs"]["family_input_issues"]), 2)

    def test_deterministic_json_and_inputs_unchanged(self):
        doc = fixture()
        before = copy.deepcopy(doc)
        a, b = run(doc), run(doc)
        self.assertEqual(json.dumps(a, sort_keys=True, allow_nan=False), json.dumps(b, sort_keys=True, allow_nan=False))
        self.assertEqual(doc, before)
        serialized = json.dumps(a)
        self.assertNotIn("C:\\", serialized)
        self.assertNotIn("AppData", serialized)


if __name__ == "__main__":
    unittest.main()
