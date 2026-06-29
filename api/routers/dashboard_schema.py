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
    "media",
    "html",
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
    "heatmap",
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
    # Cyclical time-of-week dims derived from posted_at - the heatmap axes.
    "hour_of_day",
    "day_of_week",
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

# Report-defined computed fields (see ReportConfig) are referenced in the
# dimension/metric vocabularies as `computed:<id>`. Kept as a pattern (like
# CustomFieldDimension / CustomObjectMetric) so the Literal parity test stays
# meaningful. Mirrors the TS template-literal arm `\`computed:${string}\``.
ComputedFieldRef = Annotated[str, StringConstraints(pattern=r"^computed:[^\s]+$")]

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
AnyDimension = Union[CustomDimensionField, TopicDimension, ComputedFieldRef]
AnyMetric = Union[CustomMetric, TopicMetric, CustomObjectMetric, ComputedFieldRef]

DataSource = Literal["posts", "topics", "comments", "both"]

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
    "custom": ("bar", "pie", "doughnut", "line", "number-card", "progress-list", "word-cloud", "heatmap", "table"),
    "text": ("table",),
    "embeds": ("embed",),
    "media": ("embed",),
    "html": ("embed",),
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
    "media": {"chartType": "embed", "title": "Media", "w": 4, "h": 6},
    "html": {"chartType": "embed", "title": "HTML", "w": 6, "h": 4},
}

GRID_COLS = 12
MAX_WIDGETS = 50
# Cap on collection-mode Embed Posts cards (mirrors MAX_EMBED_COUNT in TS).
MAX_EMBED_COUNT = 30

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
    metricAgg: (
        Literal["sum", "avg", "min", "max", "count", "median", "distinct", "mode", "percent"]
        | None
    ) = None
    # Categorical field that `distinct` / `mode` run over (number-card only).
    categoricalField: AnyDimension | None = None
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


class ChartAxisStyle(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Hide the whole axis (line, ticks, gridlines, title).
    hidden: bool | None = None
    # Draw the axis title.
    showTitle: bool | None = None
    # Custom axis-title text; empty/unset falls back to the system default.
    title: str | None = None


class ChartStyleOverrides(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accent: str | None = None
    seriesColors: dict[str, str] | None = None
    seriesLabels: dict[str, str] | None = None
    # How numeric value labels render ('abs' | 'pct' | 'abs_pct' | 'none').
    # Loose str so the Literal stays client-side; declared so it survives
    # extra='ignore' and round-trips into Firestore + shared dashboards.
    labelDisplay: str | None = None
    # Pie/doughnut on-slice label content ('name' | 'abs' | 'pct' | 'abs_pct' |
    # 'none'), independent of the legend. Declared so it survives extra='ignore'
    # and round-trips into Firestore + shared dashboards.
    sliceLabelDisplay: str | None = None
    # Doughnut-only custom center label. Declared so it isn't silently dropped
    # on save (otherwise it vanishes on refresh).
    centerLabel: str | None = None
    # Word-cloud size multiplier on the adaptive range. Declared so it survives
    # extra='ignore' and round-trips into Firestore + shared dashboards.
    wordCloudScale: float | None = None
    # Bar/line per-axis show/hide + title overrides. Declared so they survive
    # extra='ignore' and round-trip into Firestore + shared dashboards.
    xAxis: ChartAxisStyle | None = None
    yAxis: ChartAxisStyle | None = None


class FilterCondition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # `field` and `operator` are loose strings: `field` carries dynamic
    # `custom:<name>` values + the synthetic `post_count` group-row filter that a
    # Literal can't enumerate; both are validated client-side.
    field: str
    operator: str
    value: str | float
    value2: str | float | None = None
    # Selected values for `isAnyOf` / `isNoneOf` categorical operators.
    values: list[str] | None = None
    # Group-by dimension counted when `field == "post_count"`.
    dimension: str | None = None


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
    # Topic cluster ids (from list_topics / topic_metrics). Any-of match against
    # the post's topic membership - the agent's per-section story baseline.
    topics: list[str] | None = None
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
    topics: list[str] | None = None
    date_range: DateRange | None = None


# ─── Report config (report-level defaults above per-widget config) ────────────
# Persisted on the dashboard layout doc as `reportConfig`. The authoritative
# transform applies it ONCE to the shared posts (consumed by the interactive
# dashboard, the Brief, and shareable reports) so every consumer sees identical
# canonical data. Mirrors `ReportConfig` in types-social-dashboard.ts. See
# docs/report-config-architecture.md. These models store/round-trip the config;
# the transform engine that enforces accuracy lands in a later phase.


class CanonGroup(BaseModel):
    """Groups raw values into one canonical value, per chosen fields. The
    transform remaps THEN dedupes within each post's array on multi-valued
    fields, so merging can only drop or move counts, never inflate them."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    canonical: str = Field(min_length=1)
    members: list[str] = Field(default_factory=list)
    # FieldKey strings: scalar/multi-valued built-ins or `custom:<name>`.
    fields: list[str] = Field(default_factory=list)


class ExprNode(BaseModel):
    """Closed arithmetic AST node for an `expr` computed field. Recursive via
    `l`/`r`/`args`. The small node set keeps the TS and Python evaluators
    identical. Mirrors ExprNode in types-social-dashboard.ts."""

    model_config = ConfigDict(extra="ignore")

    t: Literal["num", "field", "bin", "fn"]
    v: float | None = None  # t == "num"
    ref: str | None = None  # t == "field" (an AnyMetric)
    op: Literal["+", "-", "*", "/"] | None = None  # t == "bin"
    l: "ExprNode | None" = None  # noqa: E741 - mirrors TS field name; t == "bin"
    r: "ExprNode | None" = None  # t == "bin"
    fn: Literal["min", "max", "abs"] | None = None  # t == "fn"
    args: list["ExprNode"] | None = None  # t == "fn"


class IfElseCase(BaseModel):
    """One case of an if/elif/else computed field: when ALL `when` conditions
    hold (AND), the field takes `value`. First matching case wins."""

    model_config = ConfigDict(extra="ignore")

    when: list[FilterCondition] = Field(default_factory=list)
    value: str | float


class ComputedField(BaseModel):
    """Report-defined field, referenced as `computed:<id>`. `expr` → numeric
    metric (evaluated over per-bucket aggregated leaves); `ifelse` → categorical
    dimension or per-post numeric metric. Loose-arm shape (optional `expr` /
    `cases` / `elseValue`) so both kinds round-trip; structure validated
    client-side. Mirrors ComputedField in types-social-dashboard.ts."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    kind: Literal["expr", "ifelse"]
    output: Literal["metric", "dimension"]
    expr: ExprNode | None = None  # kind == "expr"
    cases: list[IfElseCase] | None = None  # kind == "ifelse"
    elseValue: str | float | None = None  # kind == "ifelse"


class ReportConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    canonicalization: list[CanonGroup] | None = None
    # field (FieldKey) -> canonical value -> hex color.
    valueColors: dict[str, dict[str, str]] | None = None
    computedFields: list[ComputedField] | None = None


# Resolve ExprNode's self-references (`l`/`r`/`args`) now that the class exists.
ExprNode.model_rebuild()


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


class SocialMediaConfig(BaseModel):
    """Media-widget payload (aggregation == 'media'). Mirrors the TS
    `SocialMediaConfig`. Declared explicitly so it survives the save
    round-trip into Firestore (the widget model uses extra='ignore')."""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["image", "video"]
    src: str | None = None
    uploadPath: str | None = None
    fit: Literal["cover", "contain"] | None = None
    alt: str | None = None
    loop: bool | None = None
    muted: bool | None = None
    autoplay: bool | None = None
    controls: bool | None = None


class SocialEmbedConfig(BaseModel):
    """Embed Posts widget config (aggregation == 'embeds'). Mirrors the TS
    `SocialEmbedConfig`. Declared explicitly so it survives the save round-trip
    into Firestore + shared dashboards (the widget model uses extra='ignore').

    `source == 'collection'` auto-selects posts from the dashboard data ranked by
    `rankBy`, capped to `count`, minus `hiddenPostIds`; `source == 'urls'` (or no
    config) keeps the legacy manual-link behaviour via `embedUrls`."""

    model_config = ConfigDict(extra="ignore")

    source: Literal["urls", "collection"] | None = None
    display: Literal["grid", "marquee"] | None = None
    # Loose str (not a Literal) so the rank-metric vocabulary stays client-side
    # and the schema doesn't 422 if the frontend adds a metric; validated in TS.
    rankBy: str | None = None
    count: int | None = Field(default=None, ge=1, le=MAX_EMBED_COUNT)
    hiddenPostIds: list[str] | None = None
    speed: Literal["slow", "normal", "fast"] | None = None


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
    # HTML-widget snippet (aggregation == 'html'). Declared so it survives
    # extra='ignore' and round-trips into Firestore + shared/exported boards.
    # Rendered sanitized (DOMPurify, scripts stripped) on the frontend.
    htmlContent: str | None = None
    embedUrls: list[str] | None = None
    # Embed Posts widget config (collection-mode selection + layout). Declared so
    # it survives extra='ignore' and round-trips into Firestore + shared boards.
    embedConfig: SocialEmbedConfig | None = None
    # Media-widget payload (aggregation == 'media'). Declared so it round-trips
    # into Firestore + shared dashboards instead of being dropped by extra='ignore'.
    media: SocialMediaConfig | None = None
    figureText: str | None = None
    # Widget stays in the layout but is excluded from view mode, shared
    # dashboards, and PDF export (edit mode renders it dimmed with a badge).
    # Declared explicitly so it survives extra='ignore' and so update_dashboard
    # patches setting it are not reported as ignored_fields. Absent → visible.
    hidden: bool | None = None
    # Whether the widget draws its container chrome (card surface + border +
    # shadow). Declared explicitly so it survives extra='ignore' and round-trips
    # into Firestore + shared dashboards instead of reverting on refresh. Absent
    # → the per-widget default (visible, except a heading-only text widget).
    showContainer: bool | None = None
    numberSize: Literal["small", "medium", "big"] | None = None
    # Set once the user manually resizes a text/embed card. Must be an explicit
    # field (not extra='ignore' drop) so the chosen height survives the save and
    # is honoured on shared/published dashboards instead of auto-fitting back.
    manualHeight: bool | None = None
    # KPI number-card trendline (sparkline) config. Must be declared so it
    # survives the save round-trip into Firestore and reaches the shared/Brief
    # dashboard (extra='ignore' would otherwise drop them).
    showSparkline: bool | None = None
    # Opt-in Scolto brand watermark overlaid on the rendered widget. Declared so
    # it survives the save round-trip into Firestore and reaches shared/Brief.
    showWatermark: bool | None = None
    trendDimension: AnyDimension | None = None
    trendTimeBucket: Literal["hour", "day", "week", "month"] | None = None
    trendCumulative: bool | None = None
    # Which pieces a `mode` ("Top value") number-card renders, in order.
    # Declared so it survives the Firestore round-trip onto shared/Brief boards.
    topValueParts: list[Literal["label", "count", "percent"]] | None = None


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
