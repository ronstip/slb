"""Pydantic schema for dashboard widget layouts.

Mirrors `frontend/src/features/studio/dashboard/types-social-dashboard.ts`.
Used by:
  - `api/routers/dashboard_layouts.py` — validates incoming save requests.
  - `api/agent/tools/compose_dashboard.py` — validates agent-authored layouts
    and drives self-heal logic.

Schema parity between TS and Python is enforced by
`api/tests/test_dashboard_schema_parity.py`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ─── Enums (keep in sync with types-social-dashboard.ts) ──────────────────────

SocialAggregation = Literal[
    "kpi",
    "sentiment",
    "emotion",
    "platform",
    "volume",
    "sentiment-over-time",
    "theme-cloud",
    "themes",
    "entities",
    "channels",
    "content-type",
    "language",
    "engagement-rate",
    "posts",
    "custom",
    "text",
]

SocialChartType = Literal[
    "bar",
    "pie",
    "doughnut",
    "line",
    "word-cloud",
    "table",
    "number-card",
    "progress-list",
    "data-table",
]

CustomDimension = Literal[
    "platform",
    "sentiment",
    "emotion",
    "language",
    "content_type",
    "channel_handle",
    "posted_at",
    "themes",
    "entities",
]

CustomMetric = Literal[
    "post_count",
    "like_count",
    "view_count",
    "comment_count",
    "share_count",
    "engagement_total",
]

# Valid chart types per aggregation — mirrors VALID_CHART_TYPES in TS.
VALID_CHART_TYPES: dict[str, tuple[str, ...]] = {
    "kpi": ("number-card",),
    "sentiment": ("doughnut", "pie", "bar", "progress-list"),
    "emotion": ("bar", "doughnut", "pie", "progress-list"),
    "platform": ("bar", "doughnut", "pie", "progress-list"),
    "volume": ("line",),
    "sentiment-over-time": ("line",),
    "theme-cloud": ("word-cloud", "bar"),
    "themes": ("bar", "progress-list", "doughnut"),
    "entities": ("table", "progress-list"),
    "channels": ("table", "progress-list"),
    "content-type": ("doughnut", "pie", "bar", "progress-list"),
    "language": ("pie", "doughnut", "bar", "progress-list"),
    "engagement-rate": ("line",),
    "posts": ("data-table",),
    "custom": ("bar", "pie", "doughnut", "line", "number-card", "progress-list", "word-cloud"),
    "text": ("table",),
}

# Per-aggregation defaults — mirrors AGGREGATION_META in TS.
# (label/icon/description live on the frontend; backend only needs the
# defaults used by self-heal.)
AGGREGATION_DEFAULTS: dict[str, dict] = {
    "kpi": {"chartType": "number-card", "title": "KPI", "w": 3, "h": 2},
    "sentiment": {"chartType": "doughnut", "title": "Sentiment", "w": 4, "h": 6},
    "emotion": {"chartType": "bar", "title": "Emotions", "w": 4, "h": 6},
    "platform": {"chartType": "bar", "title": "Platform", "w": 4, "h": 6},
    "volume": {"chartType": "line", "title": "Volume Over Time", "w": 12, "h": 6},
    "sentiment-over-time": {"chartType": "line", "title": "Sentiment Over Time", "w": 12, "h": 6},
    "theme-cloud": {"chartType": "word-cloud", "title": "Theme Cloud", "w": 6, "h": 7},
    "themes": {"chartType": "bar", "title": "Top Themes", "w": 6, "h": 7},
    "entities": {"chartType": "table", "title": "Top Entities", "w": 6, "h": 8},
    "channels": {"chartType": "table", "title": "Top Channels", "w": 6, "h": 8},
    "content-type": {"chartType": "doughnut", "title": "Content Type", "w": 6, "h": 6},
    "language": {"chartType": "pie", "title": "Language", "w": 6, "h": 6},
    "engagement-rate": {"chartType": "line", "title": "Engagement Rate", "w": 12, "h": 6},
    "posts": {"chartType": "data-table", "title": "Posts", "w": 12, "h": 10},
    "custom": {"chartType": "bar", "title": "Custom Chart", "w": 6, "h": 6},
    "text": {"chartType": "table", "title": "Text", "w": 6, "h": 3},
}

GRID_COLS = 12
MAX_WIDGETS = 24


# ─── Sub-models ───────────────────────────────────────────────────────────────


class CustomChartConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    dimension: CustomDimension | None = None
    metric: CustomMetric = "post_count"
    metricAgg: Literal["sum", "avg", "min", "max", "count"] | None = None
    timeBucket: Literal["day", "week", "month"] | None = None
    barOrientation: Literal["horizontal", "vertical"] | None = None
    breakdownDimension: CustomDimension | None = None


class FilterCondition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    field: Literal[
        "like_count",
        "view_count",
        "comment_count",
        "share_count",
        "engagement_total",
        "posted_at",
        "text",
    ]
    operator: Literal[
        "greaterThan",
        "lessThan",
        "equals",
        "between",
        "before",
        "after",
        "contains",
        "notContains",
        "isEmpty",
        "isNotEmpty",
    ]
    value: str | float
    value2: str | float | None = None


class DateRange(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    from_: str | None = Field(default=None, alias="from")
    to: str | None = None


class SocialWidgetFilters(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    sentiment: list[str] | None = None
    emotion: list[str] | None = None
    platform: list[str] | None = None
    language: list[str] | None = None
    content_type: list[str] | None = None
    collection: list[str] | None = None
    channels: list[str] | None = None
    themes: list[str] | None = None
    entities: list[str] | None = None
    date_range: DateRange | None = None
    conditions: list[FilterCondition] | None = None


# ─── Widget ───────────────────────────────────────────────────────────────────


class SocialDashboardWidget(BaseModel):
    """One widget in a dashboard layout.

    `extra='ignore'` so legacy widgets with fields we've since removed still
    round-trip without raising. Grid bounds are enforced in `DashboardLayout`,
    not here, so compose_dashboard can self-heal before re-validating.
    """

    model_config = ConfigDict(extra="ignore")

    i: str = Field(min_length=1)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=GRID_COLS)
    h: int = Field(ge=1)
    aggregation: SocialAggregation
    chartType: SocialChartType
    title: str
    description: str | None = None
    accent: str | None = None
    kpiIndex: int | None = Field(default=None, ge=0, le=4)
    filters: SocialWidgetFilters | None = None
    customConfig: CustomChartConfig | None = None
    markdownContent: str | None = None


class DashboardLayout(BaseModel):
    """Full layout: list of widgets + optional filter-bar pill selection."""

    model_config = ConfigDict(extra="ignore")

    layout: list[SocialDashboardWidget] = Field(max_length=MAX_WIDGETS)
    filterBarFilters: list[str] | None = None


def is_chart_type_valid_for(aggregation: str, chart_type: str) -> bool:
    return chart_type in VALID_CHART_TYPES.get(aggregation, ())
