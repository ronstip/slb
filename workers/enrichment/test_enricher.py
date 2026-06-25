"""Unit tests for the enricher's prompt rendering - focused on the new
`referenced_post` context block (Option B).
"""

from workers.enrichment.enricher import (
    ENRICHMENT_PROMPT,
    _build_content_parts,
    _render_referenced_post_block,
)
from workers.enrichment.schema import MediaRef, PostData, ReferencedPost


# ---------------------------------------------------------------------------
# _render_referenced_post_block - pure-function rendering
# ---------------------------------------------------------------------------

def test_render_referenced_block_returns_empty_when_no_ref():
    assert _render_referenced_post_block(None) == ""


def test_render_referenced_block_returns_empty_when_content_blank():
    ref = ReferencedPost(ref_type="quoted", author="bob", content="")
    assert _render_referenced_post_block(ref) == ""


def test_render_referenced_block_quote_includes_author_and_content():
    ref = ReferencedPost(
        ref_type="quoted",
        author="yaronavraham",
        content="EXCLUSIVE | Bennett on Lapid: 'Lapid is toxic, toxic, toxic'",
    )
    out = _render_referenced_post_block(ref)
    assert "quote-tweet" in out
    assert "@yaronavraham" in out
    assert "toxic, toxic, toxic" in out
    # No media note when the dep has no media.
    assert "media follows" not in out


def test_render_referenced_block_reply_uses_reply_label():
    ref = ReferencedPost(
        ref_type="replied_to", author="alice", content="What do you mean by that?",
    )
    out = _render_referenced_post_block(ref)
    assert "reply" in out
    assert "quote-tweet" not in out


def test_render_referenced_block_includes_media_note_when_dep_has_media():
    ref = ReferencedPost(
        ref_type="quoted", author="bob", content="see this!",
        media_refs=[MediaRef(gcs_uri="gs://bucket/x.jpg", media_type="image")],
    )
    out = _render_referenced_post_block(ref)
    assert "media follows" in out


def test_render_referenced_block_falls_back_to_unknown_author():
    ref = ReferencedPost(ref_type="quoted", author=None, content="something")
    out = _render_referenced_post_block(ref)
    assert "@unknown" in out


# ---------------------------------------------------------------------------
# ENRICHMENT_PROMPT format - placeholder must accept the block (or empty)
# ---------------------------------------------------------------------------

def test_enrichment_prompt_renders_with_empty_referenced_block():
    """No ref → no Context block in the rendered prompt."""
    body = ENRICHMENT_PROMPT.format(
        platform="twitter", channel_handle="alice", posted_at="2026-04-30",
        title="", content="hello world", enrichment_context="brand X",
        referenced_post_block="",
    )
    assert "Context - this post is" not in body
    assert "Content:  hello world" in body


def test_enrichment_prompt_renders_with_referenced_block():
    ref = ReferencedPost(
        ref_type="quoted", author="bob",
        content="the source content the parent is reacting to",
    )
    block = _render_referenced_post_block(ref)
    body = ENRICHMENT_PROMPT.format(
        platform="twitter", channel_handle="alice", posted_at="2026-04-30",
        title="", content="lol same energy", enrichment_context="politics",
        referenced_post_block=block,
    )
    assert "the source content the parent is reacting to" in body
    assert "@bob" in body
    # Context block precedes the Post block - anchors the model on context first.
    assert body.index("Context - this post") < body.index("Post:\n  Platform:")


# ---------------------------------------------------------------------------
# PostData carries ReferencedPost through to enrichment input
# ---------------------------------------------------------------------------

def test_post_data_accepts_referenced_post():
    pd = PostData(
        post_id="9001", platform="twitter",
        content="the quote",
        referenced_post=ReferencedPost(
            ref_type="quoted", author="bob", content="the source",
        ),
    )
    assert pd.referenced_post is not None
    assert pd.referenced_post.ref_type == "quoted"
    assert pd.referenced_post.content == "the source"


def test_post_data_default_referenced_post_is_none():
    pd = PostData(post_id="9001", platform="twitter", content="just a tweet")
    assert pd.referenced_post is None


# ---------------------------------------------------------------------------
# YouTube direct-URL video part must carry the same VideoMetadata cap as GCS
# videos, otherwise Gemini processes the full-length video at default fps and
# inflates token cost.
# ---------------------------------------------------------------------------

def _youtube_post() -> PostData:
    return PostData(
        post_id="yt1", platform="youtube",
        content="some long video",
        post_url="https://www.youtube.com/watch?v=abc123",
    )


def test_youtube_url_part_has_bounded_video_metadata():
    from config.settings import get_settings

    settings = get_settings()
    parts = _build_content_parts(_youtube_post())

    yt_parts = [
        p for p in parts
        if getattr(p, "file_data", None)
        and p.file_data.file_uri == "https://www.youtube.com/watch?v=abc123"
    ]
    assert len(yt_parts) == 1, "expected exactly one YouTube video part"

    vm = yt_parts[0].video_metadata
    assert vm is not None, "YouTube video part must set VideoMetadata (duration/fps cap)"
    assert vm.start_offset == settings.enrichment_video_start_offset
    assert vm.end_offset == settings.enrichment_video_end_offset
    assert vm.fps == settings.enrichment_video_fps


def test_youtube_url_part_omitted_when_video_skipped():
    parts = _build_content_parts(_youtube_post(), skip_video=True)
    assert not any(
        getattr(p, "file_data", None)
        and p.file_data.file_uri == "https://www.youtube.com/watch?v=abc123"
        for p in parts
    )


# ---------------------------------------------------------------------------
# Comment enrichment path: parent context + cache-friendly prompt split.
# ---------------------------------------------------------------------------

from workers.enrichment.enricher import (  # noqa: E402
    COMMENT_SYSTEM_INSTRUCTION,
    _build_comment_content_parts,
    _build_config,
    _render_comment_system_instruction,
)
from workers.enrichment.schema import ParentContext  # noqa: E402


def _comment_post() -> PostData:
    return PostData(
        post_id="c1", platform="facebook", channel_handle="dana",
        content="Leonardo Club - everything was filthy, avoid",
        parent_context=ParentContext(
            parent_ai_summary="Asking which Dead Sea hotel is worst and why.",
            parent_context="A recommendation-request thread.",
        ),
    )


def test_post_data_default_parent_context_is_none():
    pd = PostData(post_id="9002", platform="facebook", content="hi")
    assert pd.parent_context is None


def test_comment_parts_lead_with_parent_block_then_comment():
    parts = _build_comment_content_parts(_comment_post())
    texts = [getattr(p, "text", None) for p in parts]
    # First part is the parent block; it carries the parent summary.
    assert "PARENT POST" in texts[0]
    assert "which Dead Sea hotel is worst" in texts[0]
    # Second part is the comment itself.
    assert "Comment to analyze" in texts[1]
    assert "filthy" in texts[1]


def test_comment_content_parts_exclude_static_instructions():
    # The static task body lives in system_instruction, NOT in the per-item
    # content - this is what makes the prefix cacheable across siblings.
    parts = _build_comment_content_parts(_comment_post())
    joined = " ".join(getattr(p, "text", "") or "" for p in parts)
    assert "Your job is to analyze" not in joined
    assert "Fields of the analysis" not in joined


def test_comment_system_instruction_holds_task_and_custom_fields():
    from workers.enrichment.schema import CustomFieldDef

    cf = [CustomFieldDef(name="hotel_mentions", description="hotels referenced", type="list[str]")]
    si = _render_comment_system_instruction("hotel reputation in Israel", cf)
    assert "hotel reputation in Israel" in si
    assert "hotel_mentions" in si            # custom field injected
    assert si.rstrip().endswith("original language.")  # IMPORTANT stays last


def test_build_config_comment_mode_sets_system_instruction_and_disables_search():
    si = _render_comment_system_instruction("task", None)
    config = _build_config(None, None, system_instruction=si, enable_search=False)
    assert config.system_instruction == si
    assert config.tools is None  # grounding off for comments


def test_build_config_posts_path_unchanged_no_system_instruction():
    # Posts must not regress: default config carries no system_instruction.
    config = _build_config(None, None)
    assert config.system_instruction is None


# ---------------------------------------------------------------------------
# list[object] custom field - schema validation + dynamic model build
# ---------------------------------------------------------------------------

import pytest
from pydantic import ValidationError

from workers.enrichment.enricher import (
    _build_custom_fields_model,
    _build_custom_fields_prompt,
)
from workers.enrichment.schema import CustomFieldDef


def _men_field() -> CustomFieldDef:
    return CustomFieldDef(
        name="men",
        description="People mentioned in the post",
        type="list[object]",
        element_fields=[
            {"name": "name", "description": "Person name", "type": "str"},
            {"name": "age", "description": "Person age", "type": "int"},
        ],
    )


def test_list_object_requires_element_fields():
    with pytest.raises(ValidationError):
        CustomFieldDef(name="men", description="x", type="list[object]")


def test_list_object_nulls_element_fields_for_other_types():
    f = CustomFieldDef(
        name="topic",
        description="x",
        type="str",
        element_fields=[{"name": "name", "description": "x", "type": "str"}],
    )
    assert f.element_fields is None


def test_element_fields_validate_literal_options():
    with pytest.raises(ValidationError):
        CustomFieldDef(
            name="men",
            description="x",
            type="list[object]",
            element_fields=[{"name": "role", "description": "x", "type": "literal"}],
        )


def test_build_model_accepts_valid_list_object():
    Model = _build_custom_fields_model([_men_field()])
    inst = Model(men=[{"name": "Alice", "age": 30}, {"name": "Bob", "age": 35}])
    assert inst.men[0].name == "Alice"
    assert inst.men[1].age == 35


def test_build_model_coerces_or_rejects_bad_leaf_type():
    Model = _build_custom_fields_model([_men_field()])
    with pytest.raises(ValidationError):
        Model(men=[{"name": "Alice", "age": "not-a-number"}])


def test_prompt_renders_element_subschema_as_indented_bullets():
    out = _build_custom_fields_prompt([_men_field()])
    assert "- men (list[object]):" in out
    assert "    - name (str):" in out
    assert "    - age (int):" in out


# ---------------------------------------------------------------------------
# Anti-hallucination round: relevance_reason field + context-as-yardstick
# framing + brand-grounding tightening.
# ---------------------------------------------------------------------------

from workers.enrichment.schema import EnrichmentResult
from workers.enrichment.worker import _write_results_via_values


def _minimal_result(**overrides) -> EnrichmentResult:
    base = dict(
        context="ctx", ai_summary="sum", language="en",
        sentiment="neutral", emotion="neutral",
        entities=[], themes=[], content_type="post",
        is_related_to_task=True,
    )
    base.update(overrides)
    return EnrichmentResult(**base)


def test_relevance_reason_defaults_to_empty_for_legacy_reconstruction():
    """Legacy BQ rows have no relevance_reason; reconstructing an
    EnrichmentResult from them must not raise."""
    r = _minimal_result()
    assert r.relevance_reason == ""


def test_relevance_reason_is_generated_before_is_related_to_task():
    """Field order = Gemini structured-output generation order; the reason
    must precede the boolean so the model reasons then commits."""
    fields = list(EnrichmentResult.model_fields)
    assert fields.index("relevance_reason") < fields.index("is_related_to_task")


def test_prompt_injects_task_as_yardstick_block_at_top():
    body = ENRICHMENT_PROMPT.format(
        platform="twitter", channel_handle="alice", posted_at="2026-04-30",
        title="", content="hello", enrichment_context="acme running shoes",
        referenced_post_block="",
    )
    # Task text surfaces as an explicit yardstick near the top, before the
    # field list, and is framed as a relevance yardstick (not a content hint).
    assert "acme running shoes" in body
    assert "yardstick" in body.lower()
    assert body.index("acme running shoes") < body.index("- context:")


def test_prompt_lists_relevance_reason_before_is_related():
    body = ENRICHMENT_PROMPT.format(
        platform="x", channel_handle="a", posted_at="t",
        title="", content="c", enrichment_context="task",
        referenced_post_block="",
    )
    assert "- relevance_reason:" in body
    assert body.index("- relevance_reason:") < body.index("- is_related_to_task:")


def test_prompt_brand_instruction_forbids_inferred_brands():
    body = ENRICHMENT_PROMPT.format(
        platform="x", channel_handle="a", posted_at="t",
        title="", content="c", enrichment_context="task",
        referenced_post_block="",
    )
    brand_line = next(
        ln for ln in body.splitlines() if ln.startswith("- detected_brands:")
    )
    low = brand_line.lower()
    assert "do not" in low or "don't" in low
    assert "infer" in low


class _FakeBQ:
    def __init__(self):
        self.sql = None

    def query(self, sql, *args, **kwargs):
        self.sql = sql
        return []


def test_write_path_persists_relevance_reason_column():
    bq = _FakeBQ()
    r = _minimal_result(relevance_reason="post explicitly reviews the acme shoe")
    _write_results_via_values(
        bq, [("p1", r)], collection_id="c1", agent_id="a1", agent_version=2,
    )
    assert "relevance_reason" in bq.sql
    assert "post explicitly reviews the acme shoe" in bq.sql
