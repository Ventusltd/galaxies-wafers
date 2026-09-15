# Source interface layer candidates

These five lazy CodeFeatureCollections use issued line keys only. They neither
change the substrate nor establish executable composition or engineering approval.
The existing manifest is deliberately untouched. The builder emits
`manifest-entries.json` in the new output directory; its checked-in copy is
`build/codex-manifest-entries.json`, an integration fragment for the publishing
owner. Merge those entries into the current manifest without replacing its
existing entries, checking IDs for collisions and verifying file hashes.

## Reproduce

Python 3.9 or later; standard library only. Keep the public input cache outside
the checkout and choose an output directory that does not yet exist:

```text
python -B build/build_layers_codex.py --input-dir <external-cache> --fetch --output-dir <new-output>
python -B -m unittest discover -s proof -p layers_codex_test.py -v
```

Omit `--fetch` to rebuild entirely offline. Every input is pinned by repository,
full commit, path and Git blob digest in `codex-sources.json`; a mismatched cache
file is refused, not overwritten. Output records SHA-256 and byte counts. The
generation timestamp is fixed in the specification so repeated builds match.
The builder reads source as data and never executes indexed source files.

## Evidence boundaries

| Layer | What is established | What is not established |
| --- | --- | --- |
| SLD families | 698 registered Ss family features, 414 distinct first-line keys | One current cartridge containing all those functions, or callable exports |
| SLD requirements | Seven literal source guards in the pinned cartridge | Numbered requiring-family anchors; zero dependency lines are drawn |
| Pipeline News | One indexed function span matches the current source exactly and contains all five requested literal reader calls | Complete runtime URL delivery or equivalent surrounding releases |
| Deep-link interface | Ten exact source-matched sender-side helper families | The actual Atlas receiver endpoint; no sender-to-receiver edge is drawn |
| Periodic table | Pinned source contains the requested literal parameter reads | Exact numbered reader-family anchors; zero marks are drawn |

Current-file bridges require the entire indexed span to appear exactly once,
without whitespace normalization. Both source versions and the span digest are
retained. This is local textual equivalence, not whole-file or runtime equivalence.
Module contract parameters are context for the deep-link helpers, not claims
that every helper directly reads every parameter.

Guard and reader discovery uses bounded literal-pattern matching, not a JavaScript
parser or data-flow analysis. The current reported matches were source-reviewed;
new source pins require review for comments, strings, receiver types and missed
dynamic calls. Published source-place lists may be truncated: an unanchored result
means no exact anchor was established in the inspected inputs, not that none exists.

The above-100-kW engineer/experience criterion is explicitly project policy, not
a claim about universal law. All power levels remain illustrative, uncertified
physics on this surface.
