"""End-to-end smoke test for Option B (X API quote/reply unpacking).

Hits the real X API + real Gemini. Skips BQ/Firestore - runs the adapter
in-memory, finds an unpacked quote/reply pair, enriches both posts, and prints
funnel numbers + side-by-side AI summaries so we can verify the parent's
enrichment now references the dep's content.

Usage:
    .venv/bin/python scripts/test_option_b_e2e.py

Cost: 1 X API page (~1 read) + 2 Gemini calls.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Load .env into os.environ before any package imports.
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Quiet down the noisier loggers.
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("google.api_core").setLevel(logging.WARNING)


KEYWORD = "Trump"
N_POSTS = 60
LOOKBACK_HOURS = 24


def main() -> None:
    from config.settings import get_settings
    from workers.collection.adapters.x_api import XAPIAdapter
    from workers.enrichment.enricher import _build_config, _enrich_single_post
    from workers.enrichment.schema import MediaRef, PostData, ReferencedPost
    from google import genai
    from google.genai import types

    settings = get_settings()
    print(f"\n{'='*72}")
    print(f"Option B end-to-end test")
    print(f"  unpack_referenced_posts = {settings.x_api_unpack_referenced_posts}")
    print(f"  enrichment_model        = {settings.enrichment_model}")
    print(f"  gcp_project             = {settings.gcp_project_id}")
    print(f"{'='*72}\n")

    if not settings.x_api_unpack_referenced_posts:
        print("ABORT - flag is OFF. Set X_API_UNPACK_REFERENCED_POSTS=true in .env.")
        return

    # ---------------------------------------------------------------------
    # 1. Collect via XAPIAdapter
    # ---------------------------------------------------------------------
    adapter = XAPIAdapter()
    end = datetime.now(timezone.utc) - timedelta(seconds=30)
    start = end - timedelta(hours=LOOKBACK_HOURS)

    config = {
        "platforms": ["twitter"],
        "keywords": [KEYWORD],
        "max_posts_per_keyword": N_POSTS,
        "time_range": {"start": start, "end": end},
        "sort_order": "relevancy",
    }

    print(f"Collecting: keyword={KEYWORD!r}, n={N_POSTS}, "
          f"window={start.isoformat()} → {end.isoformat()}")
    batches = adapter.collect(config)
    stats = adapter.platform_stats.get("twitter", {})

    print("\n--- Funnel ---")
    print(f"  Batches:           {stats.get('batches', 0)}")
    print(f"  Total posts:       {stats.get('posts', 0)}")
    print(f"  Primary posts:     {stats.get('primary_posts', 0)}")
    print(f"  Referenced posts:  {stats.get('referenced_posts', 0)}")
    print(f"  Errors:            {stats.get('errors', 0)}")

    all_posts = [p for b in batches for p in b.posts]
    posts_by_id = {p.post_id: p for p in all_posts}

    parents_with_deps = [
        p for p in all_posts
        if p.enrichment_dependency_post_id and p.enrichment_dependency_post_id in posts_by_id
    ]
    print(f"\n  Parents with hydrated dep in-batch: {len(parents_with_deps)}")

    if not parents_with_deps:
        print("\nABORT - no quote/reply pair where the dep was hydrated. "
              "Try a wider window or different keyword.")
        return

    # Pick the first quote (most semantically interesting) over a reply, if available.
    parent = next(
        (p for p in parents_with_deps if p.enrichment_dependency_type == "quoted"),
        parents_with_deps[0],
    )
    dep = posts_by_id[parent.enrichment_dependency_post_id]

    print(f"\n--- Picked pair ---")
    print(f"  Parent: @{parent.channel_handle}  id={parent.post_id}")
    print(f"          type={parent.enrichment_dependency_type!r}")
    print(f"          url={parent.post_url}")
    print(f"          content: {(parent.content or '')[:120]}")
    print(f"  Dep:    @{dep.channel_handle}  id={dep.post_id}")
    print(f"          url={dep.post_url}")
    print(f"          content: {(dep.content or '')[:120]}")

    # ---------------------------------------------------------------------
    # 2. Build ReferencedPost context for the parent (text-only - we skip
    #    media download since this is a non-pipeline test). Mirrors what
    #    `_resolve_referenced_post` would build at runtime.
    # ---------------------------------------------------------------------
    referenced_post = ReferencedPost(
        ref_type=parent.enrichment_dependency_type,
        author=dep.channel_handle,
        content=dep.content or "",
        media_refs=[],
    )

    # ---------------------------------------------------------------------
    # 3. Enrich both - parent WITH context, dep STANDALONE
    # ---------------------------------------------------------------------
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=300_000),
    )
    config_obj = _build_config(custom_fields=None, content_types=None)

    parent_pd = PostData(
        post_id=parent.post_id,
        platform="twitter",
        channel_handle=parent.channel_handle,
        posted_at=parent.posted_at.isoformat() if parent.posted_at else None,
        title=parent.title,
        content=parent.content,
        post_url=parent.post_url,
        search_keyword=KEYWORD,
        media_refs=[],
        referenced_post=referenced_post,
    )
    dep_pd = PostData(
        post_id=dep.post_id,
        platform="twitter",
        channel_handle=dep.channel_handle,
        posted_at=dep.posted_at.isoformat() if dep.posted_at else None,
        title=dep.title,
        content=dep.content,
        post_url=dep.post_url,
        search_keyword=KEYWORD,
        media_refs=[],
        referenced_post=None,  # dep enriches standalone
    )

    # Also enrich the parent WITHOUT dep context, to A/B prove the win.
    parent_pd_no_context = parent_pd.model_copy(update={"referenced_post": None})

    print(f"\n--- Enriching ---")
    print(f"  (1) Dep, standalone")
    _, dep_result = _enrich_single_post(
        client, settings.enrichment_model, config_obj, dep_pd,
        custom_fields=None, enrichment_context=KEYWORD,
    )

    print(f"  (2) Parent, WITH ReferencedPost context")
    _, parent_result_with = _enrich_single_post(
        client, settings.enrichment_model, config_obj, parent_pd,
        custom_fields=None, enrichment_context=KEYWORD,
    )

    print(f"  (3) Parent, WITHOUT context (A/B baseline)")
    _, parent_result_without = _enrich_single_post(
        client, settings.enrichment_model, config_obj, parent_pd_no_context,
        custom_fields=None, enrichment_context=KEYWORD,
    )

    # ---------------------------------------------------------------------
    # 4. Side-by-side report
    # ---------------------------------------------------------------------
    print(f"\n{'='*72}")
    print(f"RESULTS")
    print(f"{'='*72}")

    def _print_summary(label: str, r) -> None:
        print(f"\n--- {label} ---")
        if r is None:
            print("  ENRICHMENT FAILED")
            return
        print(f"  sentiment:   {r.sentiment}")
        print(f"  emotion:     {r.emotion}")
        print(f"  language:    {r.language}")
        print(f"  channel_typ: {r.channel_type}")
        print(f"  entities:    {r.entities[:8]}")
        print(f"  themes:      {r.themes[:8]}")
        print(f"  context:     {r.context[:300]}")
        print(f"  ai_summary:  {r.ai_summary[:500]}")

    _print_summary(f"DEP (@{dep.channel_handle}) - standalone", dep_result)
    _print_summary(f"PARENT (@{parent.channel_handle}) - WITHOUT context (baseline)", parent_result_without)
    _print_summary(f"PARENT (@{parent.channel_handle}) - WITH context (Option B)", parent_result_with)

    # ---------------------------------------------------------------------
    # 5. Semantic check - does parent-with-context reference the dep?
    # ---------------------------------------------------------------------
    print(f"\n{'='*72}")
    print(f"SEMANTIC CHECK")
    print(f"{'='*72}")

    def _check_references_dep(r, label: str) -> bool:
        if r is None:
            print(f"  {label}: ENRICHMENT FAILED")
            return False
        # Cheap proxy: does parent's summary mention the dep author or any
        # entity from the dep's enrichment that wasn't in the parent's text?
        pieces = " ".join([r.context or "", r.ai_summary or ""]).lower()
        dep_handle_in = (dep.channel_handle or "").lower() in pieces
        dep_word_overlap = 0
        if dep_result is not None:
            for e in (dep_result.entities or [])[:6]:
                if e.lower() in pieces:
                    dep_word_overlap += 1
        print(f"  {label}:")
        print(f"    dep handle (@{dep.channel_handle}) referenced: {dep_handle_in}")
        print(f"    dep entities present in parent summary:        {dep_word_overlap}")
        return dep_handle_in or dep_word_overlap > 0

    print()
    with_context_signal = _check_references_dep(parent_result_with, "WITH context (Option B)")
    print()
    without_context_signal = _check_references_dep(parent_result_without, "WITHOUT context (baseline)")

    print()
    if with_context_signal and not without_context_signal:
        print("  ✓ Option B improves grounding - context aware vs. not.")
    elif with_context_signal and without_context_signal:
        print("  ~ Both versions have some dep grounding - pair may be too easy "
              "to interpret without context. Try a more cryptic quote-tweet.")
    elif not with_context_signal and not without_context_signal:
        print("  ✗ Neither version references the dep - context likely didn't "
              "land (check prompt rendering or pick another pair).")
    else:
        print("  ?? baseline references dep but Option B doesn't - unexpected.")

    print(f"\n{'='*72}\n")


if __name__ == "__main__":
    main()
