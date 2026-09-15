# The Bond — bounded evidence, version 2

Select a layer to inspect its claim, checked predicates, first deviations,
disclosed gaps and statements not evaluated. The selected layer has a shareable
fragment link. Unknown or ambiguous layer links produce a visible explanation.

This is an immutable source snapshot, not a live score. Counters are recomputed
from report rows and predicates in the same pure `model.mjs` used by the page's
tests. Check units combine different structural and semantic predicates; their
ratio is not a percentage of prose proved. Zero contradictions does not mean
complete verification. Disclosures do not excuse contradictions.

## Changes from version 1

- Optional source tables are validated and fail closed.
- Copying owner upper bounds require declared completeness and consistency with
  supplied family arrays. Observed ownership above the bound contradicts it.
- Complete module rendering remains explicitly not evaluated; matching aggregate
  counts cannot silently certify missing or duplicated rendered features.
- Selected-layer links, keyboard focus, check denominators and malformed-report
  refusal are covered by tests of the actual page model.

The published report does not supply an independent character/owner map or block
register. Dependent claims remain not evaluated. See API.md for the exact optional
input contract and its trust boundary. A completeness flag cannot prove missing
external source data.

## Reproduce

Use Python 3.12 and Node.js. Python modules use the standard library only.

```text
python -B -m unittest discover -s . -p "test_*.py" -v
node --test model.test.mjs
node --check app.mjs
python -B verify_bundle.py --version-dir . --output <new-receipt.json>
python -B build_report.py --galaxy-repo <source-checkout> --commit <full-commit> --input-dir <external-cache> --generated-utc <UTC-time> --output <new-report.json>
```

The source commit's `build/codex-sources.json` pins `all-lines.bin`, `lines.bin`
and `families.json` by Git blob. The builder checks these exact input bytes,
reads committed layer files as data and never executes indexed source code.
Choose a new output path; historical reports are not overwritten.

## Serve or copy

Required browser files: `index.html`, `style.css`, `app.mjs`, `model.mjs`,
`report.json`, and unchanged `wafer.mjs`. All runtime paths are relative; no root
manifest, service or large source pack is required to view the report.
README.md and API.md provide linked documentation. Serve through an HTTP server
or copy the whole version directory to another static host.

The wafer's canonical LF SHA-256 is
`3f7a57344a804fbc7e7352155b40fe0d3cae42c8f6d1fd50a7dfc4b6234c0809`;
its Git blob is `56514b6fa9cbfa61b0944ae18bcb7d599628f22b`.
The preview samples the first 128 distinct issued keys per layer in feature order.
It is not the full database. Selection colour is not a verdict scale.

Code-evidence inspection is not engineering design or certification. This page
publishes no new grid-network dataset and establishes no physical performance claim.
