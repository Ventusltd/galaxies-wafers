# The Bond validator 2.0.0

The callable `audit` API retains the v1 signature and compatible report fields. Output stays `schema: "bond.v1"`; `validator_version: "2.0.0"` separately identifies this validator. The accepted v1 implementation is frozen in its original directory.

```python
report = audit(manifest, layers, issued_keys, families, family_lines,
               raw_bytes=raw_bytes,
               independent_lines=independent_lines,
               block_register=block_register)
```

The core uses only Python 3.12 standard-library modules, performs no I/O, and does not mutate input objects. The CLI handles explicit input paths and a new output file. Existing output files are never overwritten.

## Inputs

- `manifest`: parsed wafer.v1 layer manifest.
- `layers`: dictionary mapping manifest file or layer ID to parsed documents. Manifest file lookup takes precedence.
- `issued_keys`: actual unique positive uint32 line keys, maximum 4,294,967,295. Invalid keys produce failed input checks.
- `families`: array of records, a mapping of records, or `{families: [...]}`. Each family has a unique positive integer `n` and either `lines: [issued line keys]` or `lineOffset`/`lineCount` into `family_lines`. Family IDs are a separate identifier domain; they are never substituted for line keys.
- `family_lines`: supplied integer sequence decoded from the exact matching little-endian uint32 line pack. Preserve order and repeated keys. Invalid family records, slices, duplicate IDs, and unissued keys are reported in `inputs.family_input_issues` and fail `inputs.family_arrays`.
- `raw_bytes`: optional dictionary using the same file/ID keys, containing original `bytes` or `bytearray` values. Original bytes are checked against manifest length/digest and against the supplied parsed document. Missing bytes leave integrity predicates NOT EVALUATED; malformed optional values fail input checks.
- `block_register`: optional `{blocks:[{symbol,number,inside:[{family}],repos:[...]}]}` or a block-to-family-ID-array mapping. Duplicate symbols and duplicate family membership are invalid. This version has no multiplicity contract for duplicate named entries. Symbols and repository entries must be nonempty strings; present block numbers and family IDs must be positive integers. A shorthand mapping cannot establish block numbers or repositories.
- `independent_lines`: optional dictionary from positive uint32 line key, or its canonical decimal string, to the record defined below. Canonical duplicate keys such as integer `101` plus string `"101"` are invalid.

## Independent owner/length record

```json
{
  "owners": [9, 10],
  "owners_complete": true,
  "chars": 12
}
```

Every field is optional; absence reduces coverage. `owners` must be an array of distinct positive integer family IDs. `chars` must be a nonnegative integer. `owners_complete`, if present, must be a JSON boolean.

`owners_complete:true` is the caller's explicit assertion that this key's complete owner set was independently established from the matching source pack. It must be set by the adapter that established that completeness, not copied from the audited feature or inferred from seeing two owners. V2 checks internal incidence consistency; it cannot independently discover omitted families outside the supplied source inputs. A flag or digest alone does not establish authenticity or completeness.

The owner-count predicate passes only when:

1. Completeness is explicitly true.
2. Every listed owner has a supplied usable family array.
3. Every listed owner's array contains the line key.
4. The listed set equals all observed owners in the supplied usable family arrays.
5. The resulting count is between 2 and 40 inclusive.

Repeated occurrences of a key within one family count as one owner. Observing at least 41 distinct owning families is a contradiction even when the owner map or completeness declaration is absent. Between 2 and 40 observed families supplies no upper bound without the conditions above. A listed owner whose available family array omits the key is a contradiction. A declared complete map omitting an observed owner is a contradiction. An unknown owner's unavailable array yields NOT EVALUATED.

Character length is independently evaluated from `chars`; the same feature's `families` or `chars` properties remain inadmissible as independent evidence. V2 does not fetch or decode original line text. The input adapter owns the independent-length provenance contract.

## Module limit

Every recognized module evidence pattern gets `module.rendered_coverage` with status NOT EVALUATED and `checked:0,total:1`. V2 deliberately does not invent proof of complete rendering. Even a module with matching register counts and correct emitted routes remains PARTIALLY EVALUATED. Missing/duplicate Points or routes cannot result in HONOURED. Existing explicit route markers are still checked against the family's exact array; deleting a marker cannot bypass the whole-module coverage limit.

## Report and handling input failures

Existing row keys remain `manifest_index`, `layer_id`, `label`, `claim_text`, `status`, `predicates`, `disclosed`, `not_evaluated`, `first_deviation`, and `coverage`. Predicates remain `{id,text,status,checked,total,passed,failed,first_deviation}`. Deviations retain zero-based `feature_index` or null, `field`, `expected`, and `actual`.

New input checks cover family arrays, block register, independent line records and original byte records. Shape/identity issues are emitted in `inputs.optional_input_issues`, with standard field names and record indexes; local paths are never included. Invalid records are excluded from semantic evidence. Missing optional inputs are not themselves invalid, but dependent predicates remain NOT EVALUATED.

Consumers must refuse a report with any failed `input_checks` or any `family_input_issues`, even if an unrelated row's predicates pass. The CLI returns exit 1 for these failures or a CONTRADICTED row. A valid report may still be incomplete; exit 0 does not mean every claim is proved.

Row statuses preserve their v1 meanings: CONTRADICTED for a failed evaluated predicate; PARTIALLY EVALUATED for some semantic checks with remaining gaps; NOT EVALUATED when semantics are unavailable; HONOURED only when the recognized claim's required predicates are evaluated and pass with no remaining statements/gaps. Disclosures never waive contradictions. Unsupported prose is retained verbatim, including explanatory notes. Input documents must therefore already be public and publishable. No UNDERCLAIMED inference or status colours are introduced.

New copying coverage fields count actual candidate features, listed-owner memberships checked/total, declared complete records, consistent complete records, and independent lengths checked. Existing feature, key-reference and predicate denominators remain compatible. Output has no timestamp and is deterministic for identical inputs.

## CLI and tests

Required flags: `--manifest`, `--layers-map`, `--issued-keys`, `--output`. Optional: `--families`, `--family-lines`, `--independent-lines`, `--block-register`. `--layers-map` is a JSON mapping from manifest file/ID to an explicit source path. Binary files are decoded as little-endian uint32. No network, directory discovery, package installation or publication occurs.

Run `python -B -m unittest -v` in this directory. All 12 adversarial v1 cases are now ordinary regressions, with no expected-failure decorators. Module controls now expect explicit partial coverage; copying success controls provide the new completeness contract. Additional tests cover malformed optional shapes, source conflicts, repeated owner incidences, schema compatibility and incomplete upper bounds.
