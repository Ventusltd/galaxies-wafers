import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import verify_bundle as verifier


def report_fixture(status="PARTIALLY EVALUATED"):
    pending = status in ("PARTIALLY EVALUATED", "NOT EVALUATED")
    failed = status == "CONTRADICTED"
    predicate = {"id": "fixture", "text": "A public fixture", "status": "FAILED" if failed else "NOT EVALUATED" if pending else "PASSED", "checked": 0 if pending else 1, "total": 1, "passed": 0 if pending or failed else 1, "failed": int(failed), "first_deviation": None}
    row = {"layer_id": "example", "status": status, "predicates": [predicate], "not_evaluated": [{"field": "layer.evidence", "text": "A source claim", "reason": "Outside the fixture"}] if pending else [], "disclosed": [], "coverage": {"checks_evaluated": predicate["checked"], "checks_total": 1, "predicates": 1, "predicates_passed": int(predicate["status"] == "PASSED"), "predicates_failed": int(failed), "not_evaluated_items": int(pending), "disclosure_items": 0, "features": 2, "key_references": 3}}
    input_check = {"id": "inputs", "status": "PASSED", "checked": 1, "total": 1, "passed": 1, "failed": 0}
    return {"schema": "bond.v1", "rows": [row], "input_checks": [input_check], "inputs": {"family_input_issues": []}, "provenance": {"repo": verifier.SOURCE_REPO, "commit": "a" * 40, "manifest_sha256": "b" * 64, "sources": [{"commit": "c" * 40, "sha256": "d" * 64, "git_blob": "e" * 40, "bytes": 4}]}, "coverage": {"manifest_entries": 1, "layers_reported": 1, "features": 2, "key_references": 3, "checks_evaluated": predicate["checked"], "checks_total": 1, "status_counts": {s: int(s == status) for s in verifier.STATUSES}}}


def successes(checks):
    return all(c["status"] == "PASSED" for c in checks)


class ReportChecks(unittest.TestCase):
    def test_partial_and_not_evaluated_rows_are_valid_reports(self):
        for status in ("PARTIALLY EVALUATED", "NOT EVALUATED"):
            with self.subTest(status=status):
                checks, summary, _ = verifier.inspect_report(report_fixture(status))
                self.assertTrue(successes(checks))
                self.assertEqual(summary["statuses"][status], 1)

    def test_honest_contradiction_is_valid_report(self):
        self.assertTrue(successes(verifier.inspect_report(report_fixture("CONTRADICTED"))[0]))

    def test_short_commit_fails(self):
        report = report_fixture()
        report["provenance"]["commit"] = "abc123"
        self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_source_input_must_be_evaluated_and_passed(self):
        for status in ("FAILED", "NOT EVALUATED"):
            report = report_fixture()
            report["input_checks"][0]["status"] = status
            self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_passed_input_with_incomplete_denominator_fails(self):
        report = report_fixture()
        report["input_checks"][0]["total"] = 2
        self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_optional_source_issues_fail(self):
        report = report_fixture()
        report["inputs"]["optional_input_issues"] = [{"reason": "invalid source"}]
        self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_advertised_aggregate_count_mismatch_fails(self):
        for field in ("features", "key_references", "checks_evaluated", "checks_total", "layers_reported"):
            report = report_fixture()
            report["coverage"][field] += 1
            self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_status_count_type_and_value_mismatch_fail(self):
        for value in (True, 2):
            report = report_fixture()
            report["coverage"]["status_counts"]["PARTIALLY EVALUATED"] = value
            self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_row_count_mismatch_fails(self):
        report = report_fixture()
        report["rows"][0]["coverage"]["checks_total"] = 2
        self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_contradiction_cannot_be_hidden_as_honoured(self):
        report = report_fixture("CONTRADICTED")
        report["rows"][0]["status"] = "HONOURED"
        self.assertFalse(successes(verifier.inspect_report(report)[0]))

    def test_duplicate_layer_ids_fail(self):
        report = report_fixture()
        report["rows"].append(copy.deepcopy(report["rows"][0]))
        self.assertFalse(successes(verifier.inspect_report(report)[0]))


class BundleChecks(unittest.TestCase):
    def setUp(self):
        # Temporary fixture writes stay under this verifier's own directory.
        self.temp = tempfile.TemporaryDirectory(prefix="verifier-fixture-", dir=Path(__file__).parent)
        self.root = Path(self.temp.name).resolve()
        self.report = report_fixture()
        self.wafer = b"export const frozen = 1;\n"
        for name in verifier.REQUIRED_FILES:
            (self.root / name).write_bytes(self.wafer if name == "wafer.mjs" else b"// fixture\n")
        (self.root / "test_sample.py").write_text("# fixture\n", encoding="utf-8")
        self.save_report()
        self.pin = patch.object(verifier, "CANONICAL_WAFER_LF_SHA256", hashlib.sha256(self.wafer).hexdigest())
        self.pin.start()
        self.calls = []

    def tearDown(self):
        self.pin.stop()
        self.assertEqual(self.root.parent, Path(__file__).parent.resolve())
        self.temp.cleanup()

    def save_report(self):
        (self.root / "report.json").write_text(json.dumps(self.report), encoding="utf-8")

    def runner(self, argv, cwd, timeout):
        self.calls.append((argv, cwd, timeout))
        out = {"exit_code": 0, "timed_out": False, "available": True, "duration_ms": 1, "stdout": b"", "stderr": b"private machine path must stay out of receipt\n"}
        if "unittest" in argv:
            out["stderr"] += b"Ran 3 tests in 0.001s\nOK\n"
        elif "--test" in argv:
            out["stdout"] = b"# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n"
        elif "--input-type=module" in argv:
            out["stdout"] = json.dumps(verifier.inspect_report(self.report)[1]).encode()
        return out

    def verify(self, **kwargs):
        return verifier.verify_bundle(self.root, runner=self.runner, **kwargs)

    def test_good_bundle_passes_with_relative_hashes_only(self):
        result = self.verify()
        self.assertEqual(result["status"], "PASSED")
        self.assertTrue(all("/" not in a["file"] and "\\" not in a["file"] for a in result["artifacts"]))
        text = json.dumps(result)
        self.assertNotIn(str(self.root), text)
        self.assertNotIn("private machine path", text)
        self.assertTrue(all(call[2] == 60 for call in self.calls))

    def test_canonical_pin_normalizes_crlf_only(self):
        (self.root / "wafer.mjs").write_bytes(self.wafer.replace(b"\n", b"\r\n"))
        self.assertEqual(self.verify()["status"], "PASSED")
        (self.root / "wafer.mjs").write_bytes(self.wafer.replace(b"\n", b"\r"))
        self.assertEqual(self.verify()["status"], "FAILED")

    def test_report_digest_uses_exact_bytes(self):
        first = self.verify()
        (self.root / "report.json").write_bytes((self.root / "report.json").read_bytes() + b"\n")
        second = self.verify()
        get_hash = lambda r: next(a["sha256"] for a in r["artifacts"] if a["file"] == "report.json")
        self.assertNotEqual(get_hash(first), get_hash(second))

    def test_optional_contradiction_gate(self):
        self.report = report_fixture("CONTRADICTED")
        self.save_report()
        self.assertEqual(self.verify()["status"], "PASSED")
        self.assertEqual(self.verify(fail_on_contradiction=True)["status"], "FAILED")

    def test_node_runtime_disagreement_fails(self):
        def runner(argv, cwd, timeout):
            result = self.runner(argv, cwd, timeout)
            if "--input-type=module" in argv:
                result["stdout"] = b"{}"
            return result
        self.assertEqual(verifier.verify_bundle(self.root, runner=runner)["status"], "FAILED")

    def test_missing_browser_entrypoint_fails(self):
        (self.root / "index.html").unlink()
        result = self.verify()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(next(c for c in result["checks"] if c["id"] == "bundle.required_files")["status"], "FAILED")

    def test_timeout_and_no_test_count_fail(self):
        def runner(argv, cwd, timeout):
            result = self.runner(argv, cwd, timeout)
            if "unittest" in argv:
                result.update(exit_code=None, timed_out=True, stdout=b"", stderr=b"")
            return result
        self.assertEqual(verifier.verify_bundle(self.root, runner=runner)["status"], "FAILED")

    def test_evidence_output_is_excluded_from_hash_inventory(self):
        output = self.root / "receipt.json"
        output.write_text("{}", encoding="utf-8")
        result = self.verify(excluded_paths=[output])
        self.assertNotIn("receipt.json", [a["file"] for a in result["artifacts"]])

    def test_bundle_mutation_during_checks_fails(self):
        def runner(argv, cwd, timeout):
            result = self.runner(argv, cwd, timeout)
            if "unittest" in argv:
                (self.root / "model.mjs").write_text("// changed", encoding="utf-8")
            return result
        self.assertEqual(verifier.verify_bundle(self.root, runner=runner)["status"], "FAILED")

    def test_existing_output_is_not_overwritten(self):
        output = self.root / "existing.json"
        output.write_text("preserve", encoding="utf-8")
        with self.assertRaises(SystemExit) as error:
            verifier.main(["--version-dir", str(self.root), "--output", str(output)])
        self.assertEqual(error.exception.code, 2)
        self.assertEqual(output.read_text(), "preserve")

    def test_subprocess_timeout_is_bounded_and_sanitized(self):
        with patch.object(verifier.subprocess, "run", side_effect=subprocess.TimeoutExpired(["python"], 1, output=b"private path")):
            result = verifier.run_process(["python"], self.root, 1)
        public = verifier._public_process(result)
        self.assertTrue(public["timed_out"])
        self.assertNotIn("private path", json.dumps(public))


if __name__ == "__main__":
    unittest.main()
