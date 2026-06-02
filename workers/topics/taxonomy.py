"""Two-pass LLM topic taxonomy.

Pass 1 (parallel, batched): generate candidate topics per batch of sample posts.
Pass 2 (single call): merge near-identical candidates + emit assignment rules.

Pass 1 batches run in parallel via ThreadPoolExecutor - they do NOT see each
other's outputs, so we accept that pass 1 produces some duplicates and lean
on pass 2 to dedup. This trades some pass-2 work for ~Nx wall-clock speedup
on pass 1, which is the bulk of the cost.

The structured-output schema (response_schema=Pass1Response / Pass2Response)
guarantees parseable JSON; failures fall back to skipping a batch rather than
poisoning the whole run.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from typing import Any

from google import genai
from google.genai import types

from config.settings import get_settings
from workers.topics.prompts import (
    build_pass1_batch_section,
    build_pass2_candidates_section,
    render_pass1_prompt,
    render_pass2_merge_prompt,
    render_pass3_filter_prompt,
)
from workers.topics.schema import (
    AssignmentRule,
    MergeResponse,
    Pass1Response,
    Pass3VerdictResponse,
    Topic,
    TopicCandidate,
)

logger = logging.getLogger(__name__)


PASS1_MAX_OUTPUT_TOKENS = 16384
PASS2_MAX_OUTPUT_TOKENS = 32768
PASS3_MAX_OUTPUT_TOKENS = 8192
PASS_TEMPERATURE = 0.3
PASS3_TEMPERATURE = 0.0  # filter wants deterministic verdicts
PASS1_TIMEOUT_SEC = 180.0
PASS2_TIMEOUT_SEC = 300.0
PASS3_TIMEOUT_SEC = 120.0
PASS3_CONCURRENCY = 10

_THINKING_LEVEL_MAP = {
    "minimal": types.ThinkingLevel.MINIMAL,
    "low": types.ThinkingLevel.LOW,
    "medium": types.ThinkingLevel.MEDIUM,
    "high": types.ThinkingLevel.HIGH,
}


def _get_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )


# ---------------------------------------------------------------------------
# Pass 1
# ---------------------------------------------------------------------------


def _run_pass1_batch(
    batch_index: int,
    batch_posts: list[dict],
    model: str,
    thinking_level: str = "low",
    customer_brief: str | None = None,
) -> list[TopicCandidate]:
    """Run one pass-1 batch. Returns candidates with `source_post_ids` already
    resolved from the LLM's 1-based `source_post_indices` against this batch.
    Bad indices (out-of-range, duplicates within a candidate) are dropped.
    """
    section = build_pass1_batch_section(batch_posts)
    prompt = render_pass1_prompt(section, customer_brief=customer_brief)
    client = _get_client()

    config = types.GenerateContentConfig(
        temperature=PASS_TEMPERATURE,
        max_output_tokens=PASS1_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=Pass1Response,
    )
    thinking = _THINKING_LEVEL_MAP.get(thinking_level)
    if thinking is not None:
        config.thinking_config = types.ThinkingConfig(thinking_level=thinking)

    try:
        response = client.models.generate_content(
            model=model, contents=prompt, config=config,
        )
    except Exception:
        logger.exception("Pass-1 Gemini call failed for batch %d", batch_index)
        return []

    from api.services.cost_meter import log_gemini_response

    log_gemini_response(response, feature="topic_cluster", model=model)

    # Diagnostic logging when a batch produces zero topics so we can
    # distinguish truncation from "model decided nothing was anchorable".
    finish_reason = None
    try:
        finish_reason = response.candidates[0].finish_reason
    except (AttributeError, IndexError):
        pass

    parsed = getattr(response, "parsed", None)
    if parsed and parsed.topics:
        return _validate_pass1_candidates(parsed.topics, batch_posts, batch_index)

    # Fallback: parse raw text as Pass1Response
    text = getattr(response, "text", None)
    if not text:
        logger.warning(
            "Pass-1 batch %d: empty response (finish_reason=%s)",
            batch_index, finish_reason,
        )
        return []
    try:
        parsed_raw = Pass1Response.model_validate_json(text)
        return _validate_pass1_candidates(parsed_raw.topics, batch_posts, batch_index)
    except Exception:
        logger.warning(
            "Pass-1 batch %d: text parse failed (finish_reason=%s, len=%d, head=%r)",
            batch_index, finish_reason, len(text), text[:300],
        )
        return []


def _validate_pass1_candidates(
    raw: list[TopicCandidate],
    batch_posts: list[dict],
    batch_index: int,
) -> list[TopicCandidate]:
    """Validate and clean pass-1 output.

    Drops candidates that:
      - have no anchor (no entity/theme/brand)
      - have no valid source post (all source_post_indices out of range)

    Resolves source_post_indices (1-based) to source_post_ids (str) using
    the batch's post_id ordering. Out-of-range indices are dropped with a
    warning so a hallucinated "Post 99" in a 50-post batch doesn't poison
    membership.
    """
    n = len(batch_posts)
    keep = []
    dropped_unanchored = 0
    dropped_unsourced = 0
    bad_indices_total = 0

    for c in raw:
        anchored = bool(
            c.anchor_entities or c.anchor_themes or c.anchor_brands
        )
        if not anchored:
            dropped_unanchored += 1
            continue

        # Resolve 1-based indices → post_ids. Dedupe per candidate.
        seen_idx: set[int] = set()
        resolved_ids: list[str] = []
        for raw_idx in c.source_post_indices or []:
            if not isinstance(raw_idx, int):
                bad_indices_total += 1
                continue
            if raw_idx < 1 or raw_idx > n:
                bad_indices_total += 1
                continue
            if raw_idx in seen_idx:
                continue
            seen_idx.add(raw_idx)
            resolved_ids.append(batch_posts[raw_idx - 1]["post_id"])

        if not resolved_ids:
            dropped_unsourced += 1
            continue

        # Trim degenerate string values.
        c.anchor_entities = [e for e in (s.strip().lower() for s in c.anchor_entities) if e]
        c.anchor_themes = [e for e in (s.strip().lower() for s in c.anchor_themes) if e]
        c.anchor_brands = [e for e in (s.strip().lower() for s in c.anchor_brands) if e]
        c.anchor_content_types = [e for e in (s.strip().lower() for s in c.anchor_content_types) if e]
        c.keywords = [k for k in (s.strip() for s in c.keywords) if k]
        c.source_post_indices = sorted(seen_idx)
        c.source_post_ids = resolved_ids
        bt = (c.beat_type or "event").strip().lower()
        c.beat_type = bt if bt in {"event", "narrative", "dynamic"} else "event"
        keep.append(c)

    if dropped_unanchored or dropped_unsourced or bad_indices_total:
        logger.info(
            "Pass-1 batch %d cleanup: dropped %d unanchored, %d unsourced, ignored %d bad indices",
            batch_index, dropped_unanchored, dropped_unsourced, bad_indices_total,
        )
    return keep


def run_pass1(
    sampled_posts: list[dict],
    batch_size: int | None = None,
    concurrency: int | None = None,
    model: str | None = None,
    thinking_level: str | None = None,
    customer_brief: str | None = None,
) -> list[TopicCandidate]:
    """Pass 1: parallel batched candidate generation.

    Returns the union of all candidates across batches (duplicates expected;
    pass 2 deduplicates). `customer_brief` is injected verbatim into each
    batch's prompt so the same brief drives every batch's framing decisions
    consistently.
    """
    settings = get_settings()
    batch_size = batch_size or settings.topics_batch_size
    concurrency = concurrency or settings.topics_taxonomy_concurrency
    model = model or settings.enrichment_model  # Flash by default
    if thinking_level is None:
        thinking_level = settings.topics_pass1_thinking_level

    if not sampled_posts:
        return []

    batches: list[list[dict]] = [
        sampled_posts[i : i + batch_size]
        for i in range(0, len(sampled_posts), batch_size)
    ]
    logger.info(
        "Pass 1: %d batches of <=%d posts, concurrency=%d, model=%s, thinking=%s, customer_brief=%s",
        len(batches), batch_size, concurrency, model, thinking_level,
        "custom" if customer_brief else "default",
    )

    candidates: list[TopicCandidate] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        future_to_idx = {
            ex.submit(_run_pass1_batch, i, batch, model, thinking_level, customer_brief): i
            for i, batch in enumerate(batches)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                batch_candidates = future.result(timeout=PASS1_TIMEOUT_SEC)
            except FuturesTimeoutError:
                logger.warning("Pass-1 batch %d timed out", idx)
                continue
            except Exception:
                logger.exception("Pass-1 batch %d failed", idx)
                continue
            logger.info("Pass-1 batch %d -> %d candidates", idx, len(batch_candidates))
            candidates.extend(batch_candidates)

    logger.info("Pass 1 complete: %d total candidates", len(candidates))
    return candidates


# ---------------------------------------------------------------------------
# Pass 2
# ---------------------------------------------------------------------------


def run_pass2(
    candidates: list[TopicCandidate],
    min_match_score: int | None = None,
    model: str | None = None,
    thinking_level: str | None = None,
) -> list[Topic]:
    """Pass 2: dedupe near-identical candidates and union member lists.

    The LLM emits only groups of candidate indices (token-efficient - avoids
    the 32K-output truncation that hit when we asked it to also rewrite
    headers). Topic construction is deterministic: header/subheader from the
    longest candidate in the group, anchors are the deduped union,
    member_post_ids is the union of each candidate's source_post_ids.

    If the LLM call fails or produces malformed groups, falls back to "no-merge"
    (each candidate becomes its own topic). Better to ship granular-but-duplicated
    than to lose the run.
    """
    settings = get_settings()
    min_match_score = (
        min_match_score
        if min_match_score is not None
        else settings.topics_min_match_score
    )
    model = model or settings.enrichment_model
    if thinking_level is None:
        thinking_level = settings.topics_pass2_thinking_level

    if not candidates:
        return []

    candidate_dicts = [c.model_dump() for c in candidates]
    section = build_pass2_candidates_section(candidate_dicts)
    prompt = render_pass2_merge_prompt(section)
    client = _get_client()

    config = types.GenerateContentConfig(
        temperature=PASS_TEMPERATURE,
        max_output_tokens=PASS2_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=MergeResponse,
    )
    thinking = _THINKING_LEVEL_MAP.get(thinking_level)
    if thinking is not None:
        config.thinking_config = types.ThinkingConfig(thinking_level=thinking)

    finish_reason = None
    try:
        response = client.models.generate_content(
            model=model, contents=prompt, config=config,
        )
    except Exception:
        logger.exception("Pass-2 Gemini call failed")
        return _fallback_pass2_no_merge(candidates, min_match_score)

    from api.services.cost_meter import log_gemini_response

    log_gemini_response(response, feature="topic_cluster", model=model)

    try:
        finish_reason = response.candidates[0].finish_reason
    except (AttributeError, IndexError):
        pass

    merge_response: MergeResponse | None = getattr(response, "parsed", None)
    if not merge_response:
        text = getattr(response, "text", None)
        if text:
            try:
                merge_response = MergeResponse.model_validate_json(text)
            except Exception:
                logger.warning(
                    "Pass-2 raw-parse failed (finish_reason=%s, len=%d, head=%r)",
                    finish_reason, len(text), text[:300],
                )

    if not merge_response or not merge_response.groups:
        logger.warning(
            "Pass-2 produced no parseable groups (finish_reason=%s) - fallback to no-merge",
            finish_reason,
        )
        return _fallback_pass2_no_merge(candidates, min_match_score)

    # Validate & repair index assignments: every candidate must appear EXACTLY
    # once. Missing candidates get their own singleton group; duplicates are
    # de-conflicted (the first group that mentions them wins). Out-of-range
    # indices are dropped with a warning.
    groups = _validate_and_repair_groups(merge_response.groups, len(candidates))

    topics = [
        _build_topic_from_group(
            [candidates[i] for i in group_idx], min_match_score,
        )
        for group_idx in groups
    ]
    logger.info(
        "Pass 2: %d candidates -> %d topics (collapse ratio=%.2f, finish_reason=%s)",
        len(candidates), len(topics), len(topics) / len(candidates), finish_reason,
    )
    return topics


def _validate_and_repair_groups(
    raw_groups, n_candidates: int,
) -> list[list[int]]:
    """Convert 1-based, possibly-malformed merge groups into clean 0-based
    index lists where every candidate appears exactly once.
    """
    seen: set[int] = set()
    repaired: list[list[int]] = []
    for g in raw_groups:
        zero_based = []
        for raw_idx in g.indices:
            idx = raw_idx - 1  # 1-based -> 0-based
            if idx < 0 or idx >= n_candidates:
                logger.warning(
                    "Pass-2 merge: dropping out-of-range index %d (n=%d)",
                    raw_idx, n_candidates,
                )
                continue
            if idx in seen:
                logger.warning(
                    "Pass-2 merge: candidate %d already assigned, ignoring duplicate",
                    raw_idx,
                )
                continue
            seen.add(idx)
            zero_based.append(idx)
        if zero_based:
            repaired.append(zero_based)

    # Any candidates the model forgot get a singleton group.
    missing = [i for i in range(n_candidates) if i not in seen]
    if missing:
        logger.warning(
            "Pass-2 merge: %d candidates missing from groups, adding as singletons",
            len(missing),
        )
        for i in missing:
            repaired.append([i])

    return repaired


def _build_topic_from_group(
    members: list[TopicCandidate], min_match_score: int,
) -> Topic:
    """Construct a final Topic from a group of merged candidates.

    Header/subheader: longest one in the group (proxy for most specific).
    Anchors/keywords: deduped union, preserving the order of first appearance.
    member_post_ids: union of every candidate's source_post_ids - the LLM's
        explicit claim of which sampled posts are about this beat.
    Rule: built directly from anchors + keywords (kept for search/audit; not
        used for assignment in v2).
    """
    primary = max(members, key=lambda c: len(c.header) + len(c.subheader))

    def _union(attr: str) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for m in members:
            for v in getattr(m, attr, []) or []:
                v_norm = v.strip().lower() if attr != "keywords" else v.strip()
                key = v_norm.lower()
                if not v_norm or key in seen:
                    continue
                seen.add(key)
                out.append(v_norm)
        return out

    entities = _union("anchor_entities")
    themes = _union("anchor_themes")
    brands = _union("anchor_brands")
    content_types = _union("anchor_content_types")
    keywords = _union("keywords")[:8]  # cap at 8 to keep rule lean

    # Union of sampled member post ids across all merged candidates.
    seen_pid: set[str] = set()
    member_post_ids: list[str] = []
    for m in members:
        for pid in m.source_post_ids or []:
            if pid in seen_pid:
                continue
            seen_pid.add(pid)
            member_post_ids.append(pid)

    return Topic(
        header=primary.header,
        subheader=primary.subheader,
        keywords=keywords,
        anchor_entities=entities,
        anchor_themes=themes,
        anchor_brands=brands,
        anchor_content_types=content_types,
        member_post_ids=member_post_ids,
        rule=AssignmentRule(
            any_entities=entities,
            any_themes=themes,
            any_brands=brands,
            any_content_types=content_types,
            any_keywords=keywords,
            min_match_score=min_match_score,
        ),
    )


def _fallback_pass2_no_merge(
    candidates: list[TopicCandidate], min_match_score: int,
) -> list[Topic]:
    """If pass 2 fails entirely, promote each candidate to a topic untouched.
    Better to ship granular-but-duplicated topics than to lose the run.
    """
    return [_build_topic_from_group([c], min_match_score) for c in candidates]


# ---------------------------------------------------------------------------
# Pass 3 - post-hoc per-topic membership filter
# ---------------------------------------------------------------------------


def _run_pass3_topic(
    topic: Topic,
    pid_to_summary: dict[str, str],
    model: str,
    thinking_level: str,
) -> tuple[list[str], int]:
    """Run pass-3 verification on one topic. Returns (kept_pids, n_dropped).

    On any LLM error or unparseable response, falls back to KEEPING all members
    (no filtering applied) so a transient failure doesn't silently empty a topic.
    """
    pids = list(topic.member_post_ids or [])
    if not pids:
        return [], 0
    summaries = [pid_to_summary.get(pid) or "(no summary)" for pid in pids]
    prompt = render_pass3_filter_prompt(topic.header, topic.subheader, summaries)

    client = _get_client()
    config = types.GenerateContentConfig(
        temperature=PASS3_TEMPERATURE,
        max_output_tokens=PASS3_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=Pass3VerdictResponse,
    )
    thinking = _THINKING_LEVEL_MAP.get(thinking_level)
    if thinking is not None:
        config.thinking_config = types.ThinkingConfig(thinking_level=thinking)

    try:
        response = client.models.generate_content(
            model=model, contents=prompt, config=config,
        )
    except Exception:
        logger.exception("Pass-3 LLM call failed for topic %r - keeping all", topic.header[:60])
        return pids, 0

    from api.services.cost_meter import log_gemini_response

    log_gemini_response(response, feature="topic_cluster", model=model)

    parsed: Pass3VerdictResponse | None = getattr(response, "parsed", None)
    if not parsed:
        text = getattr(response, "text", None)
        if text:
            try:
                parsed = Pass3VerdictResponse.model_validate_json(text)
            except Exception:
                pass
    if not parsed or not parsed.verdicts:
        logger.warning("Pass-3 unparseable for topic %r - keeping all", topic.header[:60])
        return pids, 0

    by_idx = {v.index: v.fits for v in parsed.verdicts}
    kept: list[str] = []
    for i, pid in enumerate(pids, 1):
        # Missing verdicts default to KEEP (conservative - don't drop on model omission).
        if by_idx.get(i, True):
            kept.append(pid)
    return kept, len(pids) - len(kept)


def run_pass3_filter(
    topics: list[Topic],
    sampled_posts: list[dict],
    *,
    model: str | None = None,
    thinking_level: str | None = None,
    min_members_after: int | None = None,
    concurrency: int = PASS3_CONCURRENCY,
) -> list[Topic]:
    """Per-topic membership filter. Strips posts whose primary subject / stance
    doesn't match the beat. Mutates `topics` in place (rewrites member_post_ids)
    and returns the surviving subset (topics with >= min_members_after members).

    Cost: one LLM call per topic. ~50 calls on a typical run.
    """
    settings = get_settings()
    model = model or settings.enrichment_model
    if thinking_level is None:
        thinking_level = settings.topics_pass3_thinking_level
    if min_members_after is None:
        min_members_after = settings.topics_pass3_min_members_after

    if not topics:
        return topics

    pid_to_summary = {
        p["post_id"]: (p.get("ai_summary") or "") for p in sampled_posts
    }
    n_before_topics = len(topics)
    n_before_members = sum(len(t.member_post_ids or []) for t in topics)

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        fut_to_topic = {
            ex.submit(_run_pass3_topic, t, pid_to_summary, model, thinking_level): t
            for t in topics
        }
        for future in as_completed(fut_to_topic):
            t = fut_to_topic[future]
            try:
                kept, _dropped = future.result(timeout=PASS3_TIMEOUT_SEC)
            except FuturesTimeoutError:
                logger.warning("Pass-3 timed out for topic %r - keeping all", t.header[:60])
                continue
            except Exception:
                logger.exception("Pass-3 task crashed for topic %r - keeping all", t.header[:60])
                continue
            t.member_post_ids = kept

    surviving = [t for t in topics if len(t.member_post_ids) >= min_members_after]
    n_after_members = sum(len(t.member_post_ids) for t in surviving)
    logger.info(
        "Pass 3: topics %d -> %d (%d dropped), members %d -> %d (%.1f%% removed)",
        n_before_topics, len(surviving), n_before_topics - len(surviving),
        n_before_members, n_after_members,
        100.0 * (1 - n_after_members / max(n_before_members, 1)),
    )
    return surviving
