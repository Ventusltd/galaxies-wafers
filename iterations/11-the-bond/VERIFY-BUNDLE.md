# Portable Bond bundle verification

Ship `verify_bundle.py` and `test_verify_bundle.py` inside the timestamped public Bond directory. It runs offline with existing Python 3.12+ and Node installations; it does not install tools, fetch repositories, publish files, or create a CI workflow.

From any working directory:

```text
python /path/to/version/verify_bundle.py --version-dir /path/to/version --output /path/to/new-receipt.json
```

The output must be a new file and its parent directory must already exist. Existing output is refused and exclusive creation prevents overwrites. The output can be inside or outside the selected version directory. It is excluded from artifact hashing and is written only after verification. `--timeout-seconds` defaults to 60 and must be between 1 and 120; that limit applies to each subprocess. The verifier scans only the selected directory's immediate public artifact files, not its parent repository or other checkouts.

## Checks

- Run `python -B -m unittest discover -s . -p test_*.py -v` in the selected version. At least one unskipped test must execute. Receipt counts include tests, skips and expected failures.
- Run `node --test --test-reporter=tap model.test.mjs`; at least one test must pass and failures/cancellations must be zero.
- Run `node --check` on each immediate `.mjs` and `.js` file.
- Pin `wafer.mjs` to SHA-256 `3f7a57344a804fbc7e7352155b40fe0d3cae42c8f6d1fd50a7dfc4b6234c0809`, normalizing CRLF to LF only. Bare CR and all other content are preserved. The receipt explicitly labels this normalized canonical check; artifact hashes, including `report.json`, always hash exact original bytes.
- Require a `bond.v1` report with the expected public source repository and a full 40-character commit, full manifest SHA-256, and full source identity records. No network lookup is performed, so identity shape is checked rather than remote commit existence.
- Require every source input check to be PASSED with nonzero, fully evaluated coverage. Any failed, unevaluated or incomplete input check, family-input issue or optional-input issue fails bundle verification.
- Recount each predicate, row, aggregate feature/key-reference total and verdict count. Reject mismatched advertised totals or inconsistent contradiction/HONOURED statuses.
- Execute `model.validateReport` and `model.summarise` against `report.json` in Node and compare the runtime summary with the independently counted Python summary.
- Hash the immediate public artifact files before checks and verify that the file inventory/hashes are unchanged afterward. Files resolving outside the selected directory are rejected.

Feature and key-reference totals are reconciled from the report's row coverage; this verifier does not reload the external source layer pack or re-establish original feature counts. That remains the validator/build-report adapter's job. The receipt identifies this as local bundle consistency.

## Claim status versus bundle status

PARTIALLY EVALUATED and NOT EVALUATED rows are valid truthful report outcomes and do not fail CI. An honestly reported CONTRADICTED row also passes bundle verification when its predicates and counts agree. The public receipt includes the computed verdict counts and an explicit `bundle_scope` statement.

Teams that want a separate policy gate can add `--fail-on-contradiction`. It changes neither the report nor its claim statuses; it adds a failed bundle check if any row is CONTRADICTED.

Exit 0: bundle checks passed. Exit 1: a receipt was written and one or more bundle checks failed. Exit 2: invalid arguments, existing output, or the receipt could not be produced. A successful bundle receipt is not a claim that every audited source statement is true.

## Public receipt

Receipt schema: `bond.bundle-verification.v1`; verifier version: `1.0.0`.

It contains only relative artifact filenames, exact byte lengths/hashes, source commit/manifest identities, counted runtime summaries, check statuses, subprocess exit/timeout results, durations, and hashes of captured output. It never includes raw stdout/stderr, absolute machine paths, repository checkout paths, or communication logs. Full subprocess output remains private and is discarded after counts are parsed. The CLI prints only overall status, receipt digest and aggregate check counts.

The verifier does not hash its own new receipt. If a previous receipt is already a public JSON artifact in the directory, it may appear as an ordinary existing artifact in a later verification unless it is the explicitly excluded output path.

## Tests and existing CI runners

`python -B -m unittest -v test_verify_bundle.py` runs offline regression fixtures with mocked subprocess results. They test normalization, raw-byte hashes, source-input failures, counts, runtime disagreement, optional contradiction policy, output privacy, timeouts, mutation detection and refusal to overwrite. Temporary fixtures stay below the test file's own directory and are removed after each test.

An existing CI job can invoke the same command shown above and collect the new receipt as an artifact. No repository-wide workflow or ownership change is required.
