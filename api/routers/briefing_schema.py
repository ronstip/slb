"""Pydantic schema for the agent-composed Briefing page.

Distinct from the per-run `briefing` field on agent runs (state_of_the_world /
open_threads / process_notes) — that is an INPUT to this newsletter-style
page (the agent's reflection for continuity), not the page itself.

Stories are polymorphic via a discriminated union on `type`:
  - `topic`: anchors to a semantic cluster of social posts (what people are
    talking about).
  - `data`: an analytical finding authored by the agent — EMV leader,
    competitive gap, anomaly, record, momentum shift, etc. Anchored with
    metrics and an optional chart.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# ─── Building blocks ────────────────────────────────────────────────


class MetricItem(BaseModel):
    label: str = Field(description='Short uppercase label, e.g. "EMV", "SHARE OF VOICE"')
    value: str = Field(description='Display value with units, e.g. "$2.3M", "37%", "12.4K"')
    delta: str | None = Field(
        default=None,
        description='Optional change indicator, e.g. "+12% WoW", "-3.1pt"',
    )
    tone: Literal["positive", "negative", "neutral"] | None = Field(
        default=None,
        description="Optional emphasis color for the value",
    )


class ChartSpec(BaseModel):
    chart_type: Literal["bar", "line", "pie", "doughnut", "table"]
    data: dict = Field(
        description="Chart-library-consumable payload. For bar/line: "
        '{"labels": [...], "series": [{"name": ..., "values": [...]}]}. '
        'For pie/doughnut: {"segments": [{"label": ..., "value": ...}]}. '
        'For table: {"columns": [...], "rows": [[...]]}.'
    )
    title: str | None = None


# ─── Stories ────────────────────────────────────────────────────────


class TopicStory(BaseModel):
    type: Literal["topic"] = "topic"
    topic_id: str = Field(description="cluster_id from list_topics")
    headline: str = Field(description="Editorial headline, 50-90 chars, active voice")
    blurb: str = Field(
        description="For hero: 2-3 sentence lede that weaves in numbers. "
        "For secondary/rail: 1-2 sentence blurb."
    )
    rank: int = Field(description="Placement rank within the section (1..N)")
    section_label: str | None = Field(
        default=None,
        description='Hero-only: uppercase kicker, e.g. "TOP STORY", "IN FOCUS"',
    )


class DataStory(BaseModel):
    type: Literal["data"] = "data"
    headline: str
    blurb: str
    rank: int
    section_label: str | None = None
    metrics: list[MetricItem] = Field(
        description="2-4 numbers that ARE the story. Required — a data story without "
        "numbers is just a topic story.",
        min_length=1,
    )
    chart: ChartSpec | None = Field(
        default=None,
        description="Optional visualization (bar, line, pie, table). Use when the "
        "comparison or trend is clearer visually than as a metric strip.",
    )
    timeframe: str | None = Field(
        default=None,
        description='Optional human-readable window, e.g. "Apr 2 → Apr 12", "last 7d"',
    )
    citations: list[str] = Field(
        default_factory=list,
        description="post_ids of posts backing the finding. Cite when available.",
    )


Story = Annotated[Union[TopicStory, DataStory], Field(discriminator="type")]


# ─── Pulse (aggregate header stats) ─────────────────────────────────


class PulseSentiment(BaseModel):
    positive_pct: int
    negative_pct: int
    neutral_pct: int
    mixed_pct: int


class Pulse(BaseModel):
    total_posts: int
    total_views: int
    topic_count: int
    sentiment: PulseSentiment
    posts_per_day: list[int] = Field(
        default_factory=list,
        description="Daily post counts oldest → newest (typically 7 days). Renders as sparkline.",
    )


# ─── Layout ─────────────────────────────────────────────────────────


class BriefingLayout(BaseModel):
    hero: Story = Field(description="The single most important story for a professional reader")
    secondary: list[Story] = Field(
        description="3-4 next-most-important stories. Mix topic and data freely.",
    )
    rail: list[Story] = Field(
        description="Remaining stories in a compact strip, ordered by importance",
    )
    editors_note: str | None = Field(
        default=None,
        description="Optional one-sentence meta-commentary (data gap, anomaly, imbalance)",
    )
    # Agent may override pulse aggregates; else server computes from all topics.
    pulse_override: Pulse | None = None
    generated_at: str = Field(default="", description="Set server-side on persist")
