"""Ordinary v2 regressions converted from all twelve demonstrated v1 gaps."""
import copy
import hashlib
import unittest
import json
import bond_validator as validator


def point(family=9, key=101):
    return {"type": "Feature", "geometry": {"type": "Point", "key": key}, "properties": {"family": family, "mark": "first line"}}


def route(keys=None, marked=True):
    f = {"type": "Feature", "geometry": {"type": "LineString", "keys": [101, 102, 103] if keys is None else keys}, "properties": {"family": 9}}
    if marked:
        f["properties"]["route"] = validator.ROUTE
    return f


def module_doc(features, named=1, lines=3):
    return {"type": "CodeFeatureCollection", "substrate": "wafer.v1", "layer": {"id": "module-Ga", "evidence": f"the live block register: block Ga #14, {named} named families, {lines} numbered lines, repository Public/repo"}, "stats": {"features": len(features), "families": named, "lines": lines}, "features": features}


def copy_doc():
    return {"type": "CodeFeatureCollection", "substrate": "wafer.v1", "layer": {"id": "copying", "evidence": validator.COPYING}, "stats": {"features": 1}, "features": [{"type": "Feature", "geometry": {"type": "Point", "key": 101}, "properties": {}}]}


def register(inside=None):
    return {"blocks": [{"symbol": "Ga", "number": 14, "inside": [{"family": 9}] if inside is None else inside, "repos": ["Public/repo"]}]}


DEFAULT_FAMILIES = [{"n": 9, "lines": [101, 102, 103]}, {"n": 10, "lines": [101]}]


def audit(doc, *, families=None, blocks=None, independent=None):
    raw = json.dumps(doc, separators=(",", ":")).encode()
    ident = doc["layer"]["id"]
    manifest = {"substrate": "wafer.v1", "layers": [{"id": ident, "file": ident + ".json", "features": len(doc["features"]), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}]}
    return validator.audit(manifest, {ident: doc}, [101, 102, 103], DEFAULT_FAMILIES if families is None else families, raw_bytes={ident: raw}, block_register=blocks, independent_lines=independent)


def row(report):
    return report["rows"][0]


class FormerV1Gaps(unittest.TestCase):
    def test_module_empty_rendering_does_not_honour_three_line_claim(self):
        result = audit(module_doc([]), blocks=register())
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_module_point_only_does_not_honour_missing_route(self):
        result = audit(module_doc([point()]), blocks=register())
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_module_duplicate_logical_features_are_not_honoured(self):
        result = audit(module_doc([point(), point(), route(), route()]), blocks=register())
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_module_route_cannot_escape_validation_by_omitting_marker(self):
        result = audit(module_doc([point(), route([101, 103, 102], marked=False)]), blocks=register())
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_duplicate_block_symbols_cannot_be_silently_last_wins(self):
        blocks = register()
        stale = copy.deepcopy(blocks["blocks"][0])
        stale["inside"] = [{"family": 10}]
        blocks["blocks"].insert(0, stale)
        result = audit(module_doc([point(), route()]), blocks=blocks)
        self.assertTrue(any(p["status"] == "FAILED" for p in result["input_checks"]) or row(result)["status"] != "HONOURED")

    def test_duplicate_independent_family_membership_not_counted_twice(self):
        result = audit(module_doc([point(), route()], named=2, lines=6), blocks=register([{"family": 9}, {"family": 9}]))
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_negative_copying_owner_ids_are_invalid(self):
        result = audit(copy_doc(), independent={101: {"owners": [-1, -2], "chars": 12}})
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_known_forty_one_owners_defeat_claimed_two_owner_subset(self):
        families = [{"n": n, "lines": [101]} for n in range(1, 42)]
        result = audit(copy_doc(), families=families, independent={101: {"owners": [1, 2], "chars": 12}})
        self.assertEqual(row(result)["status"], "CONTRADICTED")

    def test_supplied_owner_family_arrays_must_contain_the_line(self):
        families = [{"n": 9, "lines": [102]}, {"n": 10, "lines": [103]}]
        result = audit(copy_doc(), families=families, independent={101: {"owners": [9, 10], "chars": 12}})
        self.assertEqual(row(result)["status"], "CONTRADICTED")

    def test_incomplete_owner_membership_does_not_prove_upper_bound(self):
        result = audit(copy_doc(), independent={101: {"owners": [9, 10], "owners_complete": False, "chars": 12}})
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_null_independent_line_record_returns_report_not_exception(self):
        result = audit(copy_doc(), independent={101: None})
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_null_block_array_returns_report_not_exception(self):
        result = audit(module_doc([point(), route()]), blocks={"blocks": None})
        self.assertNotEqual(row(result)["status"], "HONOURED")


class Controls(unittest.TestCase):
    def test_valid_full_module_with_exact_register_and_route(self):
        result = audit(module_doc([point(), route()]), blocks=register())
        self.assertEqual(row(result)["status"], "PARTIALLY EVALUATED")

    def test_explicit_wrong_route_marker_is_already_caught(self):
        result = audit(module_doc([point(), route([101, 103, 102])]), blocks=register())
        self.assertEqual(row(result)["status"], "CONTRADICTED")

    def test_no_independent_copying_input_is_already_withheld(self):
        result = audit(copy_doc())
        self.assertEqual(row(result)["status"], "NOT EVALUATED")

    def test_genuine_two_owner_independent_input_passes(self):
        result = audit(copy_doc(), independent={101: {"owners": [9, 10], "owners_complete": True, "chars": 12}})
        self.assertEqual(row(result)["status"], "HONOURED")

    def test_unknown_owner_count_is_already_withheld(self):
        result = audit(copy_doc(), independent={101: {"chars": 12}})
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_public_prose_keeps_module_partial_despite_structural_gap(self):
        doc = module_doc([])
        doc["layer"]["note"] = "A human explanation remains outside machine checks."
        result = audit(doc, blocks=register())
        self.assertEqual(row(result)["status"], "PARTIALLY EVALUATED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
