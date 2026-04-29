"""Unit tests for the retrieval-tuning helpers (chunking + keyword boost)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ASK_SELF_DIR = Path(__file__).resolve().parents[1]
if str(ASK_SELF_DIR) not in sys.path:
    sys.path.insert(0, str(ASK_SELF_DIR))

from ask_self_helpers import (  # noqa: E402
    CODE_CHUNK_TARGET_CHARS,
    LINE_CHUNK_OVERLAP_LINES,
    LINE_CHUNK_TARGET_CHARS,
    chunk_php,
    chunk_lines,
)
from ask_self_query import (  # noqa: E402
    DEFAULT_QUERY_KEYWORD_BOOSTS,
    EMBED_DIM,
    EMBED_MODEL,
    KEYWORD_BOOST_CAP,
    KEYWORD_BOOST_PER_HIT,
    TOP_K,
    _normalize_keyword_boosts,
    _normalize_structured_answer,
    _resolve_selected_targets,
    _unwrap_nested_structured_answer,
    compute_keyword_boost,
)
from ask_self_registry import (  # noqa: E402
    registry_relative_path,
    resolve_registry_path,
    save_registry,
)
import ask_self_ingest  # noqa: E402


class LineChunkingTests(unittest.TestCase):
    """Verify the tightened line-chunker defaults produce finer granularity."""

    def test_defaults_are_tighter_than_legacy(self):
        self.assertLessEqual(LINE_CHUNK_TARGET_CHARS, 2000)
        self.assertGreaterEqual(LINE_CHUNK_OVERLAP_LINES, 10)

    def test_medium_file_yields_multiple_chunks(self):
        # ~4000 chars of line content -> must split into >= 2 chunks
        text = "\n".join(f"line {i:04d} " + ("x" * 60) for i in range(60))
        chunks = chunk_lines(text)
        self.assertGreaterEqual(len(chunks), 2)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), LINE_CHUNK_TARGET_CHARS + 80)

    def test_short_file_stays_single_chunk(self):
        text = "\n".join(f"short {i}" for i in range(10))
        self.assertEqual(len(chunk_lines(text)), 1)

    def test_overlap_preserves_boundary_lines(self):
        text = "\n".join(f"line-{i:03d} " + ("y" * 80) for i in range(80))
        chunks = chunk_lines(text)
        self.assertGreaterEqual(len(chunks), 2)
        tail_of_first = chunks[0].splitlines()[-LINE_CHUNK_OVERLAP_LINES:]
        head_of_second = chunks[1].splitlines()[:LINE_CHUNK_OVERLAP_LINES]
        # At least one line from the tail of chunk[0] must repeat in chunk[1]
        self.assertTrue(set(tail_of_first) & set(head_of_second))


class PhpChunkingTests(unittest.TestCase):
    def test_splits_on_php_structural_boundaries(self):
        text = """<?php
/**
 * Plugin bootstrap.
 */

final class Cart_Totals {
    public function render_subtotal() {
        return 'subtotal';
    }

    protected static function format_price($value) {
        return wc_price($value);
    }
}

interface Total_Renderer {
    public function render();
}

trait Price_Formatters {
    private function normalize($value) {
        return (float) $value;
    }
}

function bloomz_cart_total() {
    return 'total';
}
"""
        chunks = chunk_php(text)

        self.assertGreaterEqual(len(chunks), 6)
        self.assertTrue(any(chunk.startswith("final class Cart_Totals") for chunk in chunks))
        self.assertTrue(any(chunk.startswith("public function render_subtotal") for chunk in chunks))
        self.assertTrue(any(chunk.startswith("protected static function format_price") for chunk in chunks))
        self.assertTrue(any(chunk.startswith("interface Total_Renderer") for chunk in chunks))
        self.assertTrue(any(chunk.startswith("trait Price_Formatters") for chunk in chunks))
        self.assertTrue(any(chunk.startswith("function bloomz_cart_total") for chunk in chunks))

    def test_falls_back_to_text_chunking_when_no_php_boundaries_exist(self):
        text = "<?php\n" + ("$items[] = 'value';\n" * 300)
        chunks = chunk_php(text)

        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), CODE_CHUNK_TARGET_CHARS)


class KeywordBoostTests(unittest.TestCase):
    def test_matching_query_and_source_returns_positive_boost(self):
        boost = compute_keyword_boost(
            "How is the subtotal displayed in the cart template?",
            "template",
            DEFAULT_QUERY_KEYWORD_BOOSTS,
        )
        self.assertGreater(boost, 0.0)
        self.assertLessEqual(boost, KEYWORD_BOOST_CAP)

    def test_no_match_returns_zero(self):
        boost = compute_keyword_boost(
            "Describe the release workflow",
            "template",
            DEFAULT_QUERY_KEYWORD_BOOSTS,
        )
        self.assertEqual(boost, 0.0)

    def test_cap_is_enforced(self):
        # Saturate the match count to exceed the cap.
        boosts = {f"kw{i}": ["template"] for i in range(20)}
        query = " ".join(f"kw{i}" for i in range(20))
        boost = compute_keyword_boost(query, "template", boosts)
        self.assertEqual(boost, KEYWORD_BOOST_CAP)

    def test_per_hit_increment(self):
        boosts = {"alpha": ["template"], "beta": ["template"]}
        one = compute_keyword_boost("alpha only", "template", boosts)
        two = compute_keyword_boost("alpha and beta together", "template", boosts)
        self.assertAlmostEqual(one, KEYWORD_BOOST_PER_HIT)
        self.assertAlmostEqual(two, min(2 * KEYWORD_BOOST_PER_HIT, KEYWORD_BOOST_CAP))

    def test_empty_inputs_return_zero(self):
        self.assertEqual(compute_keyword_boost("", "template", DEFAULT_QUERY_KEYWORD_BOOSTS), 0.0)
        self.assertEqual(compute_keyword_boost("subtotal", "", DEFAULT_QUERY_KEYWORD_BOOSTS), 0.0)
        self.assertEqual(compute_keyword_boost("subtotal", "template", {}), 0.0)


class KeywordBoostNormalizationTests(unittest.TestCase):
    def test_accepts_string_or_list_values(self):
        raw = {"foo": "template", "bar": ["php", "template"]}
        normalized = _normalize_keyword_boosts(raw)
        self.assertEqual(normalized["foo"], ["template"])
        self.assertEqual(normalized["bar"], ["php", "template"])

    def test_drops_empty_or_bad_entries(self):
        raw = {"": ["template"], "good": [], "bad_type": 42, "ok": ["php"]}
        normalized = _normalize_keyword_boosts(raw)
        self.assertEqual(list(normalized.keys()), ["ok"])

    def test_lowercases_keys(self):
        normalized = _normalize_keyword_boosts({"Subtotal": ["template"]})
        self.assertIn("subtotal", normalized)
        self.assertNotIn("Subtotal", normalized)

    def test_non_dict_input_returns_empty(self):
        self.assertEqual(_normalize_keyword_boosts(None), {})
        self.assertEqual(_normalize_keyword_boosts(["template"]), {})


class TopKTests(unittest.TestCase):
    def test_top_k_is_raised(self):
        self.assertGreaterEqual(TOP_K, 30)


class RegistryPathTests(unittest.TestCase):
    def test_save_registry_writes_valid_json_without_temp_file_leftover(self):
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "ask_self_registry.json"
            save_registry({"entries": [{"slug": "one"}]}, registry_path)

            self.assertTrue(registry_path.exists())
            self.assertEqual([path.name for path in registry_path.parent.iterdir()], ["ask_self_registry.json"])

    def test_registry_paths_round_trip_relative_to_registry_file(self):
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "example-repo"
            registry_path = repo_root / "temp" / "rag" / "ask_self_registry.json"
            repo_root.mkdir()
            registry_path.parent.mkdir(parents=True)

            portable_value = registry_relative_path(repo_root, registry_path)

            self.assertEqual(portable_value, "../..")
            self.assertEqual(resolve_registry_path(portable_value, registry_path), repo_root.resolve())

    def test_selected_registry_targets_resolve_relative_paths(self):
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "example-repo"
            registry_path = repo_root / "temp" / "rag" / "ask_self_registry.json"
            harness_path = repo_root / "ask_self" / "wp_theme_harness.json"
            db_path = repo_root / "temp" / "rag" / "wp-theme-self-ask.sqlite"
            harness_path.parent.mkdir(parents=True)
            db_path.parent.mkdir(parents=True)
            save_registry(
                {
                    "entries": [
                        {
                            "slug": "example-repo",
                            "repo_label": "Example Repo",
                            "repo_root": "../..",
                            "harness_config": "../../ask_self/wp_theme_harness.json",
                            "db_path": "wp-theme-self-ask.sqlite",
                            "ingest_command": "python3 ask_self/ask_self_ingest.py",
                            "embed_model": EMBED_MODEL,
                            "embed_dim": EMBED_DIM,
                        }
                    ]
                },
                registry_path,
            )

            targets = _resolve_selected_targets(
                harness_config={},
                repo_root=repo_root,
                db_path=None,
                registry_path=registry_path,
                target_slugs=["example-repo"],
                all_targets=False,
                ingest_command="fallback ingest",
            )

            self.assertEqual(targets[0]["repo_root"], str(repo_root.resolve()))
            self.assertEqual(targets[0]["db_path"], db_path.resolve())


class EmbedBatchTests(unittest.TestCase):
    def test_embed_batch_preserves_one_embedding_per_input(self):
        original_embed_one = ask_self_ingest.embed_one

        def fake_embed_one(text: str, api_key: str, *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
            return [float(len(text))] * ask_self_ingest.EMBED_DIM

        ask_self_ingest.embed_one = fake_embed_one
        try:
            embeddings = ask_self_ingest.embed_batch(["alpha", "beta"], "test-key", concurrency=2)
        finally:
            ask_self_ingest.embed_one = original_embed_one

        self.assertEqual(len(embeddings), 2)
        self.assertEqual(len(embeddings[0]), ask_self_ingest.EMBED_DIM)
        self.assertEqual(embeddings[0][0], 5.0)
        self.assertEqual(embeddings[1][0], 4.0)


class NestedAnswerUnwrapTests(unittest.TestCase):
    def test_unwraps_stringified_inner_payload(self):
        inner = {
            "answer": "real answer",
            "supporting_evidence": ["e1"],
            "caveats": ["c1"],
            "question_assessment": {"status": "clear", "reason": ""},
            "better_question": "",
            "why_this_is_better": "",
        }
        import json as _json

        outer = {
            "answer": _json.dumps(inner),
            "supporting_evidence": [],
            "caveats": [],
            "question_assessment": {"status": "clear", "reason": ""},
            "better_question": "",
            "why_this_is_better": "",
        }
        unwrapped = _unwrap_nested_structured_answer(outer)
        self.assertEqual(unwrapped["answer"], "real answer")
        self.assertEqual(unwrapped["supporting_evidence"], ["e1"])
        self.assertEqual(unwrapped["caveats"], ["c1"])

    def test_plain_answer_is_untouched(self):
        payload = {
            "answer": "a normal string answer",
            "supporting_evidence": ["x"],
            "caveats": [],
            "question_assessment": {"status": "clear", "reason": ""},
            "better_question": "",
            "why_this_is_better": "",
        }
        self.assertEqual(_unwrap_nested_structured_answer(payload), payload)

    def test_malformed_nested_json_falls_through(self):
        payload = {"answer": "{not json", "supporting_evidence": []}
        self.assertEqual(_unwrap_nested_structured_answer(payload)["answer"], "{not json")

    def test_truncated_nested_json_is_recovered(self):
        truncated = (
            '{\n  "answer": "recovered answer text",\n  '
            '"supporting_evidence": ["bit"], "caveats": [], "better_question": "", '
            '"why_this_is_better": "", "question_assessment": {"status": "clear"'
        )
        payload = {"answer": truncated}
        unwrapped = _unwrap_nested_structured_answer(payload)
        self.assertEqual(unwrapped["answer"], "recovered answer text")

    def test_normalize_applies_unwrap(self):
        import json as _json

        inner = {
            "answer": "inner answer",
            "supporting_evidence": [],
            "caveats": [],
            "question_assessment": {"status": "clear", "reason": ""},
            "better_question": "",
            "why_this_is_better": "",
        }
        normalized = _normalize_structured_answer({"answer": _json.dumps(inner)})
        self.assertEqual(normalized["answer"], "inner answer")


if __name__ == "__main__":
    unittest.main()
