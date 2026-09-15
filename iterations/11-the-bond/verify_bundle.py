"""Portable offline verification of one explicitly selected public Bond bundle."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

VERSION = "1.0.0"
CANONICAL_WAFER_LF_SHA256 = "3f7a57344a804fbc7e7352155b40fe0d3cae42c8f6d1fd50a7dfc4b6234c0809"
SOURCE_REPO = "Ventusltd/galaxies-wafers"
STATUSES = ("CONTRADICTED", "PARTIALLY EVALUATED", "NOT EVALUATED", "HONOURED")
PREDICATE_STATUSES = ("PASSED", "FAILED", "NOT EVALUATED")
ARTIFACT_SUFFIXES = frozenset({".py", ".mjs", ".js", ".json", ".html", ".css", ".md"})
REQUIRED_FILES = ("index.html", "style.css", "app.mjs", "wafer.mjs", "model.mjs", "model.test.mjs", "report.json", "bond_validator.py")
MODEL_SCRIPT = """import { readFileSync } from 'node:fs';
import { validateReport, summarise } from './model.mjs';
const report = JSON.parse(readFileSync('report.json', 'utf8'));
validateReport(report);
process.stdout.write(JSON.stringify(summarise(report.rows)));
"""
SCOPE = "Bundle consistency and executable checks; partial or unevaluated claim rows are permitted. Honest CONTRADICTED rows are permitted unless the optional contradiction gate is enabled. Source identities are checked offline; no source repository is fetched."


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _integer(n):
    return type(n) is int and 0 <= n <= 9007199254740991


def _hex(value, size):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(size) + "}", value) is not None


def _check(ident, ok, **facts):
    return {"id": ident, "status": "PASSED" if ok else "FAILED", **facts}


def run_process(argv, cwd, timeout):
    """Run without a shell; retain output privately for parsing, never receipt text."""
    started = time.monotonic()
    try:
        completed = subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
        result = {"exit_code": completed.returncode, "timed_out": False, "available": True, "stdout": completed.stdout, "stderr": completed.stderr}
    except subprocess.TimeoutExpired as error:
        result = {"exit_code": None, "timed_out": True, "available": True, "stdout": error.stdout or b"", "stderr": error.stderr or b""}
    except OSError:
        result = {"exit_code": None, "timed_out": False, "available": False, "stdout": b"", "stderr": b""}
    result["duration_ms"] = round((time.monotonic() - started) * 1000)
    return result


def _public_process(result):
    return {"exit_code": result["exit_code"], "timed_out": result["timed_out"], "available": result["available"], "duration_ms": result["duration_ms"], "stdout_sha256": digest(result["stdout"]), "stderr_sha256": digest(result["stderr"])}


def _predicate_valid(p):
    if not isinstance(p, dict) or p.get("status") not in PREDICATE_STATUSES:
        return False
    if not all(_integer(p.get(k)) for k in ("checked", "total", "passed", "failed")):
        return False
    if p["checked"] > p["total"] or p["passed"] + p["failed"] != p["checked"]:
        return False
    if p["status"] == "PASSED":
        return p["failed"] == 0 and p["checked"] == p["total"]
    if p["status"] == "FAILED":
        return p["failed"] > 0
    return p["failed"] == 0 and p["checked"] < p["total"]


def inspect_report(report):
    """Independently recount advertised totals; never copy source prose to receipts."""
    checks, summary, source = [], None, {}
    if not isinstance(report, dict):
        return [_check("report.format", False)], summary, source
    rows, inputs = report.get("rows"), report.get("input_checks")
    format_ok = report.get("schema") == "bond.v1" and isinstance(rows, list) and isinstance(inputs, list)
    checks.append(_check("report.format", format_ok))
    provenance = report.get("provenance")
    provenance_ok = isinstance(provenance, dict) and provenance.get("repo") == SOURCE_REPO and _hex(provenance.get("commit"), 40) and _hex(provenance.get("manifest_sha256"), 64)
    if provenance_ok:
        source = {"repo": SOURCE_REPO, "commit": provenance["commit"], "manifest_sha256": provenance["manifest_sha256"]}
    checks.append(_check("report.provenance", bool(provenance_ok)))
    sources = provenance.get("sources") if isinstance(provenance, dict) else None
    source_records_ok = isinstance(sources, list) and bool(sources) and all(isinstance(s, dict) and _hex(s.get("commit"), 40) and _hex(s.get("sha256"), 64) and _hex(s.get("git_blob"), 40) and _integer(s.get("bytes")) for s in sources)
    checks.append(_check("report.source_identities", source_records_ok, source_records=len(sources) if isinstance(sources, list) else 0))
    all_inputs_passed = isinstance(inputs, list) and bool(inputs) and all(_predicate_valid(p) and p["status"] == "PASSED" and p["checked"] > 0 for p in inputs)
    checks.append(_check("report.source_input_checks", all_inputs_passed, source_input_checks=len(inputs) if isinstance(inputs, list) else 0))
    input_details = report.get("inputs")
    issues_clear = isinstance(input_details, dict) and input_details.get("family_input_issues") == [] and input_details.get("optional_input_issues", []) == []
    checks.append(_check("report.source_input_issues", issues_clear))
    if not format_ok:
        return checks, summary, source
    ids, row_valid, row_totals_valid = set(), True, True
    summary = {"layers": len(rows), "statements": 0, "gapRecords": 0, "checked": 0, "total": 0, "statuses": {s: 0 for s in STATUSES}}
    features, references = 0, 0
    for r in rows:
        if not isinstance(r, dict):
            row_valid = False
            continue
        ident, status = r.get("layer_id"), r.get("status")
        ps, not_evaluated, disclosed = r.get("predicates"), r.get("not_evaluated"), r.get("disclosed")
        if not isinstance(ident, str) or not ident or ident in ids:
            row_valid = False
        else:
            ids.add(ident)
        if status not in STATUSES or not isinstance(ps, list) or not isinstance(not_evaluated, list) or not isinstance(disclosed, list) or not all(_predicate_valid(p) for p in ps):
            row_valid = False
            continue
        failed = any(p["failed"] > 0 for p in ps)
        if failed != (status == "CONTRADICTED") or (status == "HONOURED" and (not_evaluated or any(p["status"] != "PASSED" for p in ps))):
            row_valid = False
        checked, total = sum(p["checked"] for p in ps), sum(p["total"] for p in ps)
        summary["statuses"][status] += 1
        summary["checked"] += checked
        summary["total"] += total
        summary["statements"] += len(not_evaluated)
        summary["gapRecords"] += len(disclosed)
        cov = r.get("coverage")
        expected = {"checks_evaluated": checked, "checks_total": total, "predicates": len(ps), "predicates_passed": sum(p["status"] == "PASSED" for p in ps), "predicates_failed": sum(p["status"] == "FAILED" for p in ps), "not_evaluated_items": len(not_evaluated), "disclosure_items": len(disclosed)}
        if not isinstance(cov, dict) or any(not _integer(cov.get(k)) or cov[k] != value for k, value in expected.items()) or not _integer(cov.get("features")) or not _integer(cov.get("key_references")):
            row_totals_valid = False
        else:
            features += cov["features"]
            references += cov["key_references"]
    checks.append(_check("report.row_consistency", row_valid))
    checks.append(_check("report.row_totals", row_totals_valid))
    coverage = report.get("coverage")
    expected = {"manifest_entries": len(rows), "layers_reported": len(rows), "features": features, "key_references": references, "checks_evaluated": summary["checked"], "checks_total": summary["total"]}
    counts = coverage.get("status_counts") if isinstance(coverage, dict) else None
    totals_ok = isinstance(coverage, dict) and all(_integer(coverage.get(k)) and coverage[k] == value for k, value in expected.items()) and isinstance(counts, dict) and set(counts) == set(STATUSES) and all(_integer(counts[s]) and counts[s] == summary["statuses"][s] for s in STATUSES)
    checks.append(_check("report.aggregate_totals", totals_ok))
    return checks, summary, source


def _inventory(root, excluded):
    """Only this directory's public artifact suffixes; never recursively enumerate."""
    artifacts, issues = [], []
    for path in sorted(root.iterdir(), key=lambda p: p.name):
        if path.suffix.lower() not in ARTIFACT_SUFFIXES or path.resolve() in excluded:
            continue
        if path.is_dir():
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", path.name):
            issues.append("unsupported artifact filename")
            continue
        if path.resolve().parent != root:
            issues.append("artifact resolves outside the selected directory")
            continue
        try:
            raw = path.read_bytes()
            artifacts.append({"file": path.name, "bytes": len(raw), "sha256": digest(raw)})
        except OSError:
            issues.append("artifact could not be read")
    return artifacts, issues


def verify_bundle(version_dir, *, timeout_seconds=60, fail_on_contradiction=False, excluded_paths=(), runner=run_process):
    if not _integer(timeout_seconds) or not 1 <= timeout_seconds <= 120:
        raise ValueError("timeout must be between 1 and 120 seconds")
    root = Path(version_dir).resolve()
    receipt = {"schema": "bond.bundle-verification.v1", "verifier_version": VERSION, "bundle_scope": SCOPE, "status": "FAILED", "fail_on_contradiction": bool(fail_on_contradiction), "source": {}, "runtime_counts": None, "artifacts": [], "checks": []}
    checks = receipt["checks"]
    if not root.is_dir():
        checks.append(_check("bundle.directory", False))
        return receipt
    excluded = {Path(p).resolve() for p in excluded_paths}
    artifacts, inventory_issues = _inventory(root, excluded)
    receipt["artifacts"] = artifacts
    checks.append(_check("bundle.inventory", not inventory_issues, files=len(artifacts), issue_count=len(inventory_issues)))
    filenames = {a["file"] for a in artifacts}
    checks.append(_check("bundle.required_files", all(name in filenames for name in REQUIRED_FILES), required_files=len(REQUIRED_FILES), present_required_files=sum(name in filenames for name in REQUIRED_FILES)))
    python_tests = sorted(name for name in filenames if name.startswith("test_") and name.endswith(".py"))
    checks.append(_check("bundle.python_test_files", bool(python_tests), files=len(python_tests)))
    if "wafer.mjs" in filenames:
        raw = (root / "wafer.mjs").read_bytes()
        actual = digest(raw.replace(b"\r\n", b"\n"))
        receipt["canonical_wafer"] = {"file": "wafer.mjs", "normalization": "CRLF to LF only", "expected_sha256": CANONICAL_WAFER_LF_SHA256, "actual_sha256": actual}
        checks.append(_check("bundle.canonical_wafer", actual == CANONICAL_WAFER_LF_SHA256))
    summary = None
    if "report.json" in filenames:
        try:
            report = json.loads((root / "report.json").read_bytes())
            report_checks, summary, source = inspect_report(report)
            checks.extend(report_checks)
            receipt["source"] = source
            receipt["runtime_counts"] = summary
        except (ValueError, UnicodeError, OSError):
            checks.append(_check("report.decode", False))
    if fail_on_contradiction:
        count = summary["statuses"]["CONTRADICTED"] if summary else None
        checks.append(_check("report.optional_contradiction_gate", count == 0, contradicted_rows=count))
    if python_tests:
        result = runner([sys.executable, "-B", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py", "-v"], root, timeout_seconds)
        text = (result["stdout"] + result["stderr"]).decode("utf-8", errors="replace")
        matched = re.findall(r"\bRan (\d+) tests?\b", text)
        count = int(matched[-1]) if matched else 0
        skipped_matches = re.findall(r"\bskipped=(\d+)", text)
        expected_failure_matches = re.findall(r"\bexpected failures=(\d+)", text)
        skipped = int(skipped_matches[-1]) if skipped_matches else 0
        expected_failures = int(expected_failure_matches[-1]) if expected_failure_matches else 0
        checks.append(_check("python.unittest", result["exit_code"] == 0 and count > skipped, tests=count, skipped=skipped, expected_failures=expected_failures, **_public_process(result)))
    node = shutil.which("node") or "node"
    if "model.test.mjs" in filenames:
        result = runner([node, "--test", "--test-reporter=tap", "model.test.mjs"], root, timeout_seconds)
        text = result["stdout"].decode("utf-8", errors="replace")
        counts = {key: int(matches[-1]) if (matches := re.findall(r"(?m)^# " + key + r" (\d+)\s*$", text)) else None for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")}
        ok = result["exit_code"] == 0 and counts["tests"] is not None and counts["tests"] > 0 and counts["pass"] is not None and counts["pass"] > 0 and counts["fail"] == 0 and counts["cancelled"] == 0
        checks.append(_check("node.model_tests", ok, counts=counts, **_public_process(result)))
    for filename in sorted(filenames):
        if filename.endswith((".mjs", ".js")):
            result = runner([node, "--check", filename], root, timeout_seconds)
            checks.append(_check("javascript.syntax", result["exit_code"] == 0, file=filename, **_public_process(result)))
    if "model.mjs" in filenames and "report.json" in filenames:
        result = runner([node, "--input-type=module", "-e", MODEL_SCRIPT], root, timeout_seconds)
        try:
            runtime = json.loads(result["stdout"])
            agrees = summary is not None and json.dumps(runtime, sort_keys=True) == json.dumps(summary, sort_keys=True)
        except (ValueError, UnicodeError):
            agrees = False
        checks.append(_check("node.runtime_report_totals", result["exit_code"] == 0 and agrees, **_public_process(result)))
    after, after_issues = _inventory(root, excluded)
    checks.append(_check("bundle.unchanged_during_verification", not after_issues and artifacts == after))
    receipt["status"] = "PASSED" if checks and all(c["status"] == "PASSED" for c in checks) else "FAILED"
    receipt["check_counts"] = {"total": len(checks), "passed": sum(c["status"] == "PASSED" for c in checks), "failed": sum(c["status"] == "FAILED" for c in checks)}
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="new public receipt path; existing files are never replaced")
    parser.add_argument("--timeout-seconds", type=int, default=60)
    parser.add_argument("--fail-on-contradiction", action="store_true")
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.exit(2, "Receipt output already exists; choose a new file.\n")
    try:
        receipt = verify_bundle(args.version_dir, timeout_seconds=args.timeout_seconds, fail_on_contradiction=args.fail_on_contradiction, excluded_paths=[args.output])
        encoded = (json.dumps(receipt, ensure_ascii=True, indent=2, allow_nan=False) + "\n").encode()
        with args.output.open("xb") as output:
            output.write(encoded)
    except (OSError, ValueError, TypeError):
        parser.exit(2, "The selected bundle could not be verified or the new receipt could not be written.\n")
    print(json.dumps({"status": receipt["status"], "receipt_sha256": digest(encoded), "check_counts": receipt.get("check_counts", {})}))
    return 0 if receipt["status"] == "PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
