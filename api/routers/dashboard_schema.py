"""Pydantic schema for dashboard widget layouts.

Mirrors `frontend/src/features/studio/dashboard/types-social-dashboard.ts`.
Used by `api/routers/dashboard_layouts.py` to validate incoming save requests.

Schema parity between TS and Python is enforced by
`api/tests/test_dashboard_schema_parity.py`.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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
    "embeds",
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
    "embed",
]

CustomDimension = Literal[
    "platform",
    "sentiment",
    "emotion",
    "language",
    "content_type",
    "channel_type",
    "channel_handle",
    "posted_at",
    "themes",
    "entities",
    "brands",
]

# Agent-defined enrichment fields are exposed as dynamically-named dimensions
# with a `custom:<field_name>` prefix. Mirrors the TS template-literal arm
# `\`custom:${string}\`` in CustomDimension. Kept separate from the Literal so
# the parity test (which compares the Literal set against TS string literals)
# stays meaningful.
CustomFieldDimension = Annotated[str, StringConstraints(pattern=r"^custom:[^\s]+$")]
CustomDimensionField = Union[CustomDimension, CustomFieldDimension]

CustomMetric = Literal[
    "post_count",
    "like_count",
    "view_count",
    "comment_count",
    "share_count",
    "engagement_total",
]

# list[object] element metrics, namespaced `customobj:<field>.<suffix>` where the
# suffix is `__count`, `__posts`, an object leaf (e.g. `age`), or an inherited
# post metric (`post.view_count`). Mirrors the TS template-literal arm
# `\`customobj:${string}\`` in CustomMetric. Kept as a pattern (like
# CustomFieldDimension) so the Literal parity test stays meaningful.
CustomObjectMetric = Annotated[str, StringConstraints(pattern=r"^customobj:[^\s]+$")]

# ─── Topic widget vocabulary (when widget.dataSource === 'topics') ────────────
# Mirrors TopicDimension / TopicMetric in types-social-dashboard.ts. Topic
# widgets read from `social_listening.topic_metrics(@agent_id)` - see
# api/services/dashboard_service.py - and have their own dim/metric vocabularies
# distinct from the post-side `Custom*` literals.

TopicDimension = Literal[
    "topic",
    "beat_type",
    "top_content_type",
    "top_emotion",
    "platform",
    "theme",
    "entity",
    "brand",
    "channel_type",
    "emotion",
]

TopicMetric = Literal[
    "topic_count",
    "post_count",
    "total_views",
    "total_likes",
    "total_engagement",
    "avg_engagement_per_post",
    "signal_score",
    "recency_score",
    "net_sentiment",
    "sov_posts",
    "sov_views",
    "sov_engagement",
    "estimated_post_count",
    "estimated_views",
    "unique_channels",
]

# Widened types used in CustomChartConfig / TableColumn. The runtime branches
# on the widget's `dataSource` to decide which arm of the union is active;
# Pydantic validates against the union so both vocabularies round-trip.
AnyDimension = Union[CustomDimensionField, TopicDimension]
AnyMetric = Union[CustomMetric, TopicMetric, CustomObjectMetric]

DataSource = Literal["posts", "topics"]

# Post-level field - used in post-mode tables (one row per post). Mirrors
# the PostField union in types-social-dashboard.ts.
PostField = Literal[
    "post_url",
    "posted_at",
    "platform",
    "channel_handle",
    "channel_type",
    "title",
    "content",
    "ai_summary",
    "language",
    "content_type",
    "sentiment",
    "emotion",
    "themes",
    "entities",
    "brands",
    "like_count",
    "view_count",
    "comment_count",
    "share_count",
    "engagement_total",
]
CustomFieldPost = Annotated[str, StringConstraints(pattern=r"^custom:[^\s]+$")]
PostFieldRef = Union[PostField, CustomFieldPost]

# Valid chart types per aggregation - mirrors VALID_CHART_TYPES in TS.
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
    "custom": ("bar", "pie", "doughnut", "line", "number-card", "progress-list", "word-cloud", "table"),
    "text": ("table",),
    "embeds": ("embed",),
}

# Per-aggregation defaults - mirrors AGGREGATION_META in TS.
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
    "embeds": {"chartType": "embed", "title": "Embedded Posts", "w": 4, "h": 8},
}

GRID_COLS = 12
MAX_WIDGETS = 50

DashboardOrientation = Literal["horizontal", "vertical"]


# ─── Sub-models ───────────────────────────────────────────────────────────────


class CustomChartConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Vocabulary depends on the widget's `dataSource`:
    # - 'posts' (default): CustomDimension / CustomMetric (post-level).
    # - 'topics': TopicDimension / TopicMetric (topic_metrics rows).
    # Pydantic validates against the union; the runtime aggregator branches.
    dimension: AnyDimension | None = None
    metric: AnyMetric = "post_count"
    metricAgg: Literal["sum", "avg", "min", "max", "count"] | None = None
    timeBucket: Literal["hour", "day", "week", "month"] | None = None
    barOrientation: Literal["horizontal", "vertical"] | None = None
    breakdownDimension: AnyDimension | None = None
    topN: int | None = Field(default=None, ge=1, le=100)
    includeOthers: bool | None = None
    stacked: bool | None = None
    metricToggle: list[AnyMetric] | None = None
    # Running total instead of per-bucket values (time-series line charts).
    # Must round-trip through Firestore so it reaches the shared/Brief dashboard.
    cumulative: bool | None = None


class ChartStyleOverrides(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accent: str | None = None
    seriesColors: dict[str, str] | None = None
    seriesLabels: dict[str, str] | None = None


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
    channel_type: list[str] | None = None
    collection: list[str] | None = None
    channels: list[str] | None = None
    themes: list[str] | None = None
    entities: list[str] | None = None
    brands: list[str] | None = None
    # Agent-defined enrichment fields, keyed by field name. Selected values are
    # ORed within a field and ANDed across fields, matching widget UI semantics.
    custom_fields: dict[str, list[str]] | None = None
    date_range: DateRange | None = None
    conditions: list[FilterCondition] | None = None


class ReportScope(BaseModel):
    """The data scope a report commits to.

    Stored on the dashboard layout doc when an agent generates a report. Charts
    apply this as a base filter before viewer-applied filters; viewer filters
    intersect with the scope (can narrow, cannot widen). Absence (= None) means
    standalone mode - viewer filters apply freely as today.

    Dimensions mirror `SocialWidgetFilters` minus widget-only `conditions`.
    """

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


class TableColumn(BaseModel):
    """One column in a custom table widget. A column is either a metric
    aggregation or a dimension extraction (kind='dimension')."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    kind: Literal["metric", "dimension", "post-field"] | None = None
    metric: AnyMetric | None = None
    agg: Literal["sum", "avg", "min", "max", "count"] | None = None
    dimension: AnyDimension | None = None
    dimensionAgg: Literal["top", "distinct_count"] | None = None
    postField: PostFieldRef | None = None
    header: str | None = None
    viz: Literal["none", "bar", "heatmap"] | None = None
    display: Literal["abs", "pct", "abs_pct"] | None = None


class CustomTableConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # 'group' (default): cross-product rows from dimension columns; metric
    # columns aggregate within each group. 'post': one row per post; all
    # columns are kind='post-field'.
    mode: Literal["group", "post"] | None = None
    # Legacy single group-by. New configs put all dimensions in `columns` with
    # `kind='dimension'`; the frontend normalizes legacy widgets at render time.
    # Kept optional so existing stored layouts round-trip cleanly.
    dimension: AnyDimension | None = None
    columns: list[TableColumn]
    sortBy: str | None = None
    sortDir: Literal["asc", "desc"] | None = None
    rowLimit: int | None = Field(default=None, ge=1, le=500)
    showRank: bool | None = None
    density: Literal["compact", "comfortable"] | None = None
    striped: bool | None = None


# ─── Widget ───────────────────────────────────────────────────────────────────


class SocialDashboardWidget(BaseModel):
    """One widget in a dashboard layout.

    `extra='ignore'` so legacy widgets with fields we've since removed still
    round-trip without raising. Grid bounds are enforced in `DashboardLayout`,
    not here.
    """

    model_config = ConfigDict(extra="ignore")

    i: str = Field(min_length=1)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=GRID_COLS)
    h: int = Field(ge=1)
    # Which BigQuery source the widget reads. Absent → 'posts' (back-compat).
    # 'topics' widgets read from `social_listening.topic_metrics(@agent_id)`.
    dataSource: DataSource | None = None
    aggregation: SocialAggregation
    chartType: SocialChartType
    title: str
    description: str | None = None
    accent: str | None = None
    styleOverrides: ChartStyleOverrides | None = None
    kpiIndex: int | None = Field(default=None, ge=0, le=4)
    filters: SocialWidgetFilters | None = None
    customConfig: CustomChartConfig | None = None
    tableConfig: CustomTableConfig | None = None
    markdownContent: str | None = None
    embedUrls: list[str] | None = None
    figureText: str | None = None
    numberSize: Literal["small", "medium", "big"] | None = None
    # Set once the user manually resizes a text/embed card. Must be an explicit
    # field (not extra='ignore' drop) so the chosen height survives the save and
    # is honoured on shared/published dashboards instead of auto-fitting back.
    manualHeight: bool | None = None
    # KPI number-card trendline (sparkline) config. Must be declared so it
    # survives the save round-trip into Firestore and reaches the shared/Brief
    # dashboard (extra='ignore' would otherwise drop them).
    showSparkline: bool | None = None
    trendDimension: AnyDimension | None = None
    trendTimeBucket: Literal["hour", "day", "week", "month"] | None = None
    trendCumulative: bool | None = None


class DashboardLayout(BaseModel):
    """Full layout: list of widgets + optional filter-bar pill selection."""

    model_config = ConfigDict(extra="ignore")

    layout: list[SocialDashboardWidget] = Field(max_length=MAX_WIDGETS)
    filterBarFilters: list[str] | None = None
    orientation: DashboardOrientation | None = None
    reportScope: ReportScope | None = None
    # When true, hide the dashboard's filter bar entirely. Editors set this on
    # reports where viewer filtering would be misleading.
    filterBarHidden: bool | None = None


def is_chart_type_valid_for(aggregation: str, chart_type: str) -> bool:
    return chart_type in VALID_CHART_TYPES.get(aggregation, ())
