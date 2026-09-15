"""Small, offline regression checks for the additional layer builder."""
import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("layers_codex", Path(__file__).parents[1] / "build" / "build_layers_codex.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class LayerChecks(unittest.TestCase):
    def estate(self):
        return builder.Estate([11, 12, 13], [
            {"n": 1, "name": "reader", "lineOffset": 0, "lineCount": 2},
            {"n": 2, "name": "other", "lineOffset": 2, "lineCount": 1}], [11, 12, 13])

    def sources(self):
        return ({"repo": "Ventusltd/example", "commit": "a" * 40, "path": "old.js"},
                {"repo": "Ventusltd/example", "commit": "b" * 40, "path": "new.js"})

    def record(self, source):
        return {1: {"n": 1, "lines": [11, 12], "places": [{**source, "first": 1, "last": 2, "name": "reader"}]}}

    def test_block_ids_are_not_line_keys(self):
        features, stats = builder.footprint(self.estate(), [1, 2, 999])
        self.assertEqual([f["geometry"]["key"] for f in features], [11, 13])
        self.assertEqual(stats["unanchored"], [{"family": 999, "reason": "family-not-in-numbered-pack"}])

    def test_corrupt_pack_is_refused(self):
        with self.assertRaises(ValueError):
            builder.Estate([11], [{"n": 1, "lineOffset": 0, "lineCount": 2}], [11])
        with self.assertRaises(ValueError):
            builder.Estate([11], [{"n": 1, "lineOffset": 0, "lineCount": 1}], [99])
        with self.assertRaises(ValueError):
            builder.Estate([11, 11], [], [])

    def test_boolean_is_not_a_key(self):
        self.assertFalse(builder.integer(True))
        self.assertFalse(builder.integer(0))
        self.assertFalse(builder.integer(2 ** 32))

    def test_binary_alignment(self):
        with self.assertRaises(ValueError):
            builder.u32(b"bad")

    def test_input_blob_integrity(self):
        data = b"public source\n"
        pin = {"git_blob": builder.git_blob(data)}
        builder.Inputs.check("sample.js", pin, data)
        with self.assertRaises(ValueError):
            builder.Inputs.check("sample.js", pin, data + b"changed")

    def test_exact_source_not_name(self):
        old, current = self.sources()
        records = self.record(old)
        anchor, why = builder.source_anchor(self.estate(), records, current, 1)
        self.assertIsNone(anchor)
        self.assertIn("no-exact", why)

    def test_unique_exact_span_bridge(self):
        old, current = self.sources()
        records = self.record(old)
        fragment = "function reader() {\n  return 1; }\n"
        count = builder.bridge_records(records, old, current, fragment, "// heading\n" + fragment)
        self.assertEqual(count, 1)
        anchor, why = builder.source_anchor(self.estate(), records, current, 3)
        self.assertIsNone(why)
        self.assertEqual(anchor["key"], 11)
        self.assertEqual(anchor["place"]["source_equivalence"]["sha256"], builder.digest(fragment.encode()))

    def test_changed_or_ambiguous_span_not_bridged(self):
        old, current = self.sources()
        fragment = "function reader() {\n  return 1; }\n"
        for target in (fragment + fragment, fragment.replace("1", "2")):
            records = self.record(old)
            self.assertEqual(builder.bridge_records(records, old, current, fragment, target), 0)

    def test_pack_index_disagreement_refuses_anchor(self):
        old, _ = self.sources()
        records = self.record(old)
        records[1]["lines"][0] = 12
        self.assertIsNone(builder.source_anchor(self.estate(), records, old, 1)[0])

    def test_guard_extraction_does_not_claim_execution(self):
        text = "// commentary requires nothing\nif (!g) throw new Error('unit requires the geodesy module');\n"
        rules = builder.requires_rules(text)
        self.assertEqual(rules, [{"line": 2, "requires": "geodesy", "message": "unit requires the geodesy module"}])
        old, _ = self.sources()
        features, stats = builder.requires_layer(self.estate(), {}, text, old, {})
        self.assertEqual(features, [])
        self.assertEqual(len(stats["unanchored"]), 1)

    def test_reader_parameters_from_exact_span(self):
        old, _ = self.sources()
        text = 'function reader() {\nconst p = new URLSearchParams(location.search); return p.get("q"); }\n'
        features, stats = builder.url_readers(self.estate(), self.record(old), text, old, ["q", "sort"])
        self.assertEqual(len(features), 1)
        self.assertEqual(stats["parameters_anchored"], ["q"])
        self.assertEqual(stats["parameters_without_anchor"], ["sort"])

    def test_invalid_geometry_and_count_refused(self):
        features = [builder.point(11, {"family": 1})]
        doc = builder.make_layer("sld-sandbox", "Example", features, {}, [], "2026-01-01T00:00:00Z")
        builder.validate_layer(doc, {11})
        for mutate in (lambda d: d["features"][0]["geometry"].update(key=999),
                       lambda d: d["features"][0]["geometry"].update(coordinates=[0, 0]),
                       lambda d: d["stats"].update(features=0)):
            bad = copy.deepcopy(doc)
            mutate(bad)
            with self.assertRaises(ValueError):
                builder.validate_layer(bad, {11})

    def test_non_finite_serialization_refused(self):
        with self.assertRaises(ValueError):
            builder.canonical({"x": float("nan")})

    def test_empty_reason_is_in_visible_metadata(self):
        doc = builder.make_layer("periodic-table", "Table", [], {}, [], "2026-01-01T00:00:00Z")
        self.assertIn("no exact numbered family anchor", doc["layer"]["evidence"])
        self.assertIn("no marks", doc["layer"]["evidence"])

    def test_receiver_parameters_are_module_context(self):
        source, _ = self.sources()
        text = 'const CONTRACT_PARAMS = Object.freeze(["repd_ref"]);\nfunction reader() {}\n'
        features, _ = builder.receiver_layer(self.estate(), self.record(source), text, source, [1])
        self.assertEqual(features[0]["properties"]["module_contract_parameters"], ["repd_ref"])
        self.assertNotIn("shell", features[0]["properties"])

    def test_canonical_bytes_deterministic(self):
        self.assertEqual(builder.canonical({"b": 2, "a": 1}), builder.canonical({"a": 1, "b": 2}))


if __name__ == "__main__":
    unittest.main()
