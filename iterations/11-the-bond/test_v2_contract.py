import json
import unittest

from bond_validator import audit as core_audit
from test_adversarial_v2 import audit, copy_doc, module_doc, point, route, register, row


def pred(result, ident):
    return next(p for p in row(result)["predicates"] if p["id"] == ident)


class V2ContractTests(unittest.TestCase):
    def test_report_schema_is_compatible_and_validator_version_separate(self):
        result = audit(copy_doc())
        self.assertEqual(result["schema"], "bond.v1")
        self.assertEqual(result["validator_version"], "2.0.0")

    def test_complete_owner_index_with_canonical_string_key_passes(self):
        result = audit(copy_doc(), independent={"101": {"owners": [9, 10], "owners_complete": True, "chars": 12}})
        self.assertEqual(row(result)["status"], "HONOURED")

    def test_complete_flag_with_missing_owner_array_stays_unevaluated(self):
        result = audit(copy_doc(), independent={101: {"owners": [9, 99], "owners_complete": True, "chars": 12}})
        self.assertEqual(pred(result, "copying.owner_count")["status"], "NOT EVALUATED")
        self.assertNotEqual(row(result)["status"], "HONOURED")

    def test_declared_complete_list_cannot_omit_an_observed_owner(self):
        result = audit(copy_doc(), independent={101: {"owners": [9], "owners_complete": True, "chars": 12}})
        self.assertEqual(pred(result, "copying.complete_owner_consistency")["status"], "FAILED")
        self.assertEqual(row(result)["status"], "CONTRADICTED")

    def test_repeated_key_in_one_family_counts_as_one_owner(self):
        families = [{"n": 9, "lines": [101, 101, 101]}, {"n": 10, "lines": [101]}]
        result = audit(copy_doc(), families=families, independent={101: {"owners": [9, 10], "owners_complete": True, "chars": 12}})
        self.assertEqual(pred(result, "copying.owner_count")["status"], "PASSED")
        self.assertEqual(row(result)["coverage"]["copying_owner_memberships_total"], 2)

    def test_over_forty_observed_owners_fails_without_an_owner_map(self):
        result = audit(copy_doc(), families=[{"n": n, "lines": [101]} for n in range(1, 42)])
        self.assertEqual(pred(result, "copying.owner_count")["status"], "FAILED")
        self.assertEqual(row(result)["status"], "CONTRADICTED")

    def test_two_observed_owners_without_completeness_do_not_prove_bound(self):
        result = audit(copy_doc(), independent={101: {"owners": [9, 10], "chars": 12}})
        self.assertEqual(pred(result, "copying.owner_count")["status"], "NOT EVALUATED")

    def test_module_has_explicit_missing_coverage_even_when_exact(self):
        result = audit(module_doc([point(), route()]), blocks=register())
        coverage = pred(result, "module.rendered_coverage")
        self.assertEqual((coverage["checked"], coverage["total"], coverage["status"]), (0, 1, "NOT EVALUATED"))
        self.assertEqual(row(result)["status"], "PARTIALLY EVALUATED")

    def test_family_array_unissued_keys_are_input_failure(self):
        result = audit(copy_doc(), families=[{"n": 9, "lines": [999]}])
        self.assertEqual(next(p for p in result["input_checks"] if p["id"] == "inputs.family_arrays")["status"], "FAILED")

    def test_malformed_optional_tables_never_throw(self):
        malformed_blocks = [[], 1, "x", {"blocks": None}, {"blocks": 1}, {"blocks": [None]}, {"Ga": None}, {"blocks": [{"symbol": "Ga", "inside": [{"family": []}]}]}, {"blocks": [{"symbol": "Ga", "inside": [], "repos": None}]}]
        for value in malformed_blocks:
            with self.subTest(input="block_register", value=value):
                result = audit(module_doc([point()]), blocks=value)
                self.assertTrue(any(p["status"] == "FAILED" for p in result["input_checks"]))
                json.dumps(result, allow_nan=False)
        malformed_lines = [[], 1, "x", {101: None}, {101: []}, {101: {"owners": None}}, {101: {"owners": [True, 2]}}, {101: {"owners": [1, 1]}}, {101: {"owners": [{}, 2]}}, {101: {"chars": "12"}}, {101: {"owners_complete": "true"}}, {"0101": {}}, {0: {}}, {101: {}, "101": {}}]
        for value in malformed_lines:
            with self.subTest(input="independent_lines", value=value):
                result = audit(copy_doc(), independent=value)
                self.assertTrue(any(p["status"] == "FAILED" for p in result["input_checks"]))
                self.assertNotEqual(row(result)["status"], "HONOURED")
                json.dumps(result, allow_nan=False)
        for value in [1, "x", {"families": 1}, [{"n": []}], [{"n": -1, "lines": [101]}]]:
            with self.subTest(input="families", value=value):
                result = audit(copy_doc(), families=value)
                self.assertTrue(result["inputs"]["family_input_issues"])
                json.dumps(result, allow_nan=False)

    def test_malformed_raw_bytes_and_family_line_sequence_return_issues(self):
        for value in [1, [], "x", {"copying": "not bytes"}]:
            with self.subTest(input="raw_bytes", value=value):
                result = core_audit({"substrate": "wafer.v1", "layers": []}, {}, [101], raw_bytes=value)
                self.assertTrue(result["inputs"]["optional_input_issues"])
        for value in [1, {}, "x", b"binary"]:
            with self.subTest(input="family_lines", value=value):
                result = core_audit({"substrate": "wafer.v1", "layers": []}, {}, [101], [{"n": 9, "lineOffset": 0, "lineCount": 1}], value)
                self.assertTrue(result["inputs"]["family_input_issues"])


if __name__ == "__main__":
    unittest.main()
