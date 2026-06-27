"""Watch — agentic alerting model (see docs/alerts/watch-system-spec.md, ADR-0005).

A Watch generalizes the legacy `Alert` (api/schemas/alerts.py): a user-owned
monitor that fires when a condition holds over a Subject's `scope_posts`. The
condition is one of two trigger kinds — `structured` (a deterministic query over
`scope_posts`) or `semantic` (a per-run LLM judge, phase 4). This module is the
persisted shape + request/response schemas; the detector that evaluates a
structured condition lives in `workers/watches/detector.py`.

Hard rules baked in here (from the design grill):
  * A Watch NEVER creates or mutates enrichment fields — `measure.field` may only
    reference fields that already exist on the agent (built-ins + custom).
  * `scope_posts` is the only metric source; daily_metrics/entity_metrics are not
    a dependency.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.routers.dashboard_schema import SocialDashboardWidget, SocialWidgetFilters

# Cap on dashboard widgets rendered into a watch's email (parity with the legacy
# Alert's MAX_WIDGETS_PER_ALERT). Defined here, not in the soon-deleted alerts.py.
MAX_WIDGETS_PER_WATCH = 4

# ── Subject: what a Watch monitors, resolved at eval time ───────────────────

SubjectMode = Literal["agents", "all_my_agents", "all_org_agents"]
Grain = Literal["per_agent", "aggregate"]


class Subject(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: SubjectMode = "agents"
    # Only meaningful when mode == "agents". A single-agent watch is the
    # 1-element case; all_my_agents/all_org_agents resolve dynamically at eval.
    agent_ids: list[str] = Field(default_factory=list)
    grain: Grain = "per_agent"


# ── Structured trigger: a deterministic query over scope_posts ──────────────

Reducer = Literal["count", "sum", "avg", "min", "max", "p50", "p90", "distinct"]
# Built-in numeric fields plus `custom:<name>` and `custom:<name>.<element>` for
# list[object] element-grain. `distinct` pairs with a categorical field
# (channel_handle by default).
Basis = Literal["absolute", "share", "change"]
CompareOp = Literal[">", ">=", "<", "<=", "between"]


class Measure(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reducer: Reducer = "count"
    # Ignored for reducer == "count". May be a built-in (views|likes|comments|
    # shares|saves|engagement_total), `custom:<name>`, or `custom:<name>.<elem>`.
    field: str | None = None


class ShareSpec(BaseModel):
    """basis == "share": numerator = the condition's `scope` rows; denominator =
    this filter applied to the same window (None → the whole agent scope)."""

    model_config = ConfigDict(extra="ignore")

    denominator: SocialWidgetFilters | None = None


class ChangeSpec(BaseModel):
    """basis == "change": measure(this window) / measure(prior window)."""

    model_config = ConfigDict(extra="ignore")

    vs: Literal["prior_window"] = "prior_window"


class Compare(BaseModel):
    model_config = ConfigDict(extra="ignore")

    op: CompareOp = ">"
    threshold: float
    threshold2: float | None = None  # only for op == "between"

    @field_validator("threshold2")
    @classmethod
    def _between_needs_two(cls, v, info):
        if info.data.get("op") == "between" and v is None:
            raise ValueError("op 'between' requires threshold2")
        return v


class StructuredCondition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Sub-filter on the base scope_posts row-set (reuse dashboard vocab verbatim).
    scope: SocialWidgetFilters | None = None
    measure: Measure = Field(default_factory=Measure)
    basis: Basis = "absolute"
    share: ShareSpec | None = None
    change: ChangeSpec | None = None
    # Fires per-group, naming the culprit (e.g. per brand / per theme). One of the
    # dashboard dimension names (brands|themes|entities|platform|sentiment|...).
    group_by: str | None = None
    compare: Compare


class SemanticCondition(BaseModel):
    """Phase 4 — a per-run LLM judge over existing fields/content. Never compiles
    to a new enrichment field."""

    model_config = ConfigDict(extra="ignore")

    instruction: str = Field(min_length=1)
    scope: SocialWidgetFilters | None = None


# ── Window ──────────────────────────────────────────────────────────────────

WindowMode = Literal["cumulative", "rolling", "vs_prior"]


class Window(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: WindowMode = "rolling"
    # Duration in hours for rolling / vs_prior; ignored for cumulative.
    hours: int = Field(default=168, ge=1)  # 7d default


# ── Action / delivery ───────────────────────────────────────────────────────

Channel = Literal["in_app", "email", "whatsapp"]
ActionTier = Literal["notify", "briefing"]


class Action(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tier: ActionTier = "notify"
    channels: list[Channel] = Field(default_factory=lambda: ["in_app"])
    include_widgets: bool = False  # opt-in widget→PNG attachment, default off
    recipients: list[str] = Field(default_factory=list)  # default → owner email
    # Dashboard widgets rendered to PNGs and embedded in the email when
    # include_widgets is true (same schema the legacy Alert used → render path +
    # builder UI reused verbatim). Lives on Action so it serializes for free.
    widgets: list[SocialDashboardWidget] = Field(
        default_factory=list, max_length=MAX_WIDGETS_PER_WATCH
    )


# ── Source (NL provenance) ──────────────────────────────────────────────────


class WatchSource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["nl", "manual"] = "manual"
    nl_text: str | None = None  # source-of-truth for re-compile when kind == "nl"


# ── Trigger union + Watch create/update ─────────────────────────────────────

TriggerKind = Literal["structured", "semantic"]


class Trigger(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: TriggerKind = "structured"
    structured: StructuredCondition | None = None
    semantic: SemanticCondition | None = None

    @field_validator("structured")
    @classmethod
    def _structured_present(cls, v, info):
        if info.data.get("kind") == "structured" and v is None:
            raise ValueError("structured trigger requires a structured condition")
        return v


class WatchCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=120)
    subject: Subject = Field(default_factory=Subject)
    trigger: Trigger = Field(default_factory=Trigger)
    window: Window = Field(default_factory=Window)
    eval_on: Literal["schedule", "run"] = "schedule"
    # How often the scheduler re-evaluates a schedule watch (advances next_eval_at).
    # Distinct from min_interval_sec, which throttles how often a STANDING-true
    # condition re-invokes the gate.
    eval_interval_sec: int = Field(default=3600, ge=300)
    action: Action = Field(default_factory=Action)
    source: WatchSource = Field(default_factory=WatchSource)
    enabled: bool = True
    # Anti-spam backstop only — not a suitability rule (see ADR-0005).
    min_interval_sec: int = Field(default=3600, ge=0)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Watch name is required.")
        return v


class WatchUpdate(BaseModel):
    """Partial update — only provided keys are written."""

    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, max_length=120)
    subject: Subject | None = None
    trigger: Trigger | None = None
    window: Window | None = None
    eval_on: Literal["schedule", "run"] | None = None
    eval_interval_sec: int | None = None
    action: Action | None = None
    enabled: bool | None = None
    min_interval_sec: int | None = None
