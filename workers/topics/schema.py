"""Pydantic models for the LLM-taxonomy topic algorithm.

The pipeline has two LLM passes producing structured output:
  - Pass 1: per-batch candidate topics (TopicCandidate)
  - Pass 2: merged final topics with assignment rules (Topic)

Assignment to the full corpus is then a single BigQuery query that evaluates
each topic's AssignmentRule against every post's enrichment tags.
"""

from pydantic import BaseModel, Field


class TopicCandidate(BaseModel):
    """A single candidate topic emitted by pass 1.

    Anchors must come from the enrichment fields that appeared in the batch
    (open-set themes/entities/brands — no global vocabulary). Anchor lists
    feed pass 2's merge decisions.

    `source_post_indices` is the LLM's own claim about which posts inspired
    this candidate — the basis for topic membership in the v2 algorithm.
    """

    header: str = Field(
        description="News-style headline, 6-14 words, includes specific entity/brand/event"
    )
    subheader: str = Field(
        description="One sentence (<= 25 words) adding context, scope, or the so-what"
    )
    beat_type: str = Field(
        default="event",
        description=(
            "One of: 'event' (specific incident/announcement), 'narrative' "
            "(actor + ongoing stance/framing), 'dynamic' (cross-actor move). "
            "Drives pass-2 merge decisions — different beat types rarely merge."
        ),
    )
    keywords: list[str] = Field(
        default_factory=list,
        description="3-6 short phrases that characterise this topic (used as substring matchers on ai_summary)",
    )
    anchor_entities: list[str] = Field(default_factory=list)
    anchor_themes: list[str] = Field(default_factory=list)
    anchor_brands: list[str] = Field(default_factory=list)
    anchor_content_types: list[str] = Field(default_factory=list)
    source_post_indices: list[int] = Field(
        default_factory=list,
        description=(
            "1-based indices of the posts in THIS batch that are about this "
            "specific beat. At least 1 required; the LLM's claim is the source "
            "of truth for topic membership."
        ),
    )
    # Resolved by the orchestrator after pass-1 parsing — not produced by the LLM.
    source_post_ids: list[str] = Field(default_factory=list)


class Pass1Response(BaseModel):
    topics: list[TopicCandidate]


class AssignmentRule(BaseModel):
    """How a topic claims posts. A post matches the topic when its score across
    these predicates meets `min_match_score`. Score = number of predicate
    classes (entities/themes/brands/content_types/keywords) that fire.
    """

    any_entities: list[str] = Field(default_factory=list)
    any_themes: list[str] = Field(default_factory=list)
    any_brands: list[str] = Field(default_factory=list)
    any_content_types: list[str] = Field(default_factory=list)
    any_keywords: list[str] = Field(default_factory=list)
    min_match_score: int = Field(default=2, ge=1, le=5)


class Topic(BaseModel):
    """Final topic after pass-2 dedup/merge.

    `member_post_ids` is the canonical post-membership: the union of all
    pass-1 candidates' source posts that were merged into this topic. These
    are the SAMPLED posts that the LLM explicitly claimed are about this
    beat. Full-pool count is approximated via the extrapolator.

    `rule` is retained for searchability / audit / fallback but is no longer
    used to assign posts.
    """

    header: str
    subheader: str
    keywords: list[str] = Field(default_factory=list)
    anchor_entities: list[str] = Field(default_factory=list)
    anchor_themes: list[str] = Field(default_factory=list)
    anchor_brands: list[str] = Field(default_factory=list)
    anchor_content_types: list[str] = Field(default_factory=list)
    member_post_ids: list[str] = Field(default_factory=list)
    estimated_pool_count: int = 0
    estimated_pool_count_ci_low: int = 0
    estimated_pool_count_ci_high: int = 0
    rule: AssignmentRule


class Pass2Response(BaseModel):
    topics: list[Topic]


# ---------------------------------------------------------------------------
# Index-only merge response — token-efficient pass 2.
#
# The LLM emits only groups of input candidate indices. Topic construction is
# done deterministically (union of anchors, rule from anchors). This keeps the
# LLM in charge of the *merge decision* while avoiding the 32K-output-token
# truncation that bites when we ask it to also rewrite headers/subheaders.
# ---------------------------------------------------------------------------


class MergeGroup(BaseModel):
    """A group of candidate indices that the LLM believes describe the SAME
    news beat. Indices are 1-based, matching the prompt's "Candidate {i}:" labels.
    Singletons (groups of size 1) are normal and expected — most candidates
    do not have a duplicate.
    """

    indices: list[int] = Field(min_length=1)


class MergeResponse(BaseModel):
    groups: list[MergeGroup]


# ---------------------------------------------------------------------------
# Pass 3 — post-hoc per-topic membership filter
# ---------------------------------------------------------------------------


class MemberVerdict(BaseModel):
    index: int = Field(description="1-based index of the post in the prompt's list")
    fits: bool = Field(
        description=(
            "True iff the post's primary subject and stance match THIS beat. "
            "False for stance-mismatch, actor-overlap-only, or theme-overlap-only."
        )
    )
    reason: str = Field(description="<=12 word justification")


class Pass3VerdictResponse(BaseModel):
    verdicts: list[MemberVerdict]
