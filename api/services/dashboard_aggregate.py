"""Server-side widget aggregation engine (P2, slice 1: categorical primitive).

Mirrors the frontend `aggregateCustom` (frontend/.../dashboard-aggregations.ts)
for the timezone-independent **categorical group-by + number-card** primitive,
so the server can compute a widget's `WidgetData` instead of shipping every post
and aggregating client-side. The frontend uses the server series when present
and falls back to its own aggregation otherwise, so this is purely additive.

PARITY IS THE CONTRACT. The TS aggregator IS the spec; this module must
reproduce it byte-for-byte. The cross-language golden harness
(frontend/.../__parity__/parity_fixtures.json) gates every change here via
`api/tests/test_dashboard_aggregate_parity.py`. Two JS semantics that Python
does NOT share natively and are reproduced explicitly below:

  * `Math.round` rounds half AWAY from zero (toward +inf for positives), unlike
    Python's banker's `round`. `_js_round` uses `floor(x + 0.5)` to match.
  * `String(value)` for a number drops a trailing `.0` (``String(5.0) === '5'``)
    and JS only ever has one number type, so a JSON ``5.0`` and ``5`` both
    stringify to ``'5'``. `_js_string` reproduces this for dimension keys.

SCOPE (slice 1): single categorical dimension OR number-card (no dimension),
built-in + custom scalar/array dimensions, metric aggs
sum/avg/min/max/median/count/distinct/mode/percent, topN + Others. Explicitly
NOT covered (raise :class:`NotAggregatable`, caller keeps client aggregation):
time-series (`posted_at`/`hour_of_day`/`day_of_week` — viewer-local timezone,
not server-reproducible), breakdown (2D) pivots, heatmap, list[object]
(`customobj:`) metrics, and `computed:` expr/if-else metrics. Operates on the
SAME already-canonicalized post dicts the share endpoint serves (canonicalization
happens upstream in `report_transform.transform_posts`).
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from functools import cmp_to_key
from typing import Any

# Mirror DEFAULT_TOP_N / DEFAULT_BREAKDOWN_LIMIT in dashboard-aggregations.ts.
_DEFAULT_TOP_N = 50
_DEFAULT_BREAKDOWN_LIMIT = 10

_CUSTOM_PREFIX = "custom:"
_OBJECT_PREFIX = "customobj:"
_COMPUTED_PREFIX = "computed:"
# Cyclical dimensions whose bucket key depends on the viewer's local timezone in
# the FE (new Date(...).getHours()/getDay()), so the server cannot reproduce
# them. `posted_at` with day/week/month is reproducible (UTC string-slice);
# `posted_at` with the `hour` bucket is local and is refused too.
_LOCAL_TZ_DIMS = {"hour_of_day", "day_of_week"}
# Built-in array (multi-valued) fields and their post-dict attribute.
_MULTIVALUED = {"themes": "themes", "entities": "entities", "brands": "detected_brands"}


class NotAggregatable(Exception):
    """Raised when a config is outside this engine's slice (caller falls back)."""


# ─── JS-semantics helpers ──────────────────────────────────────────────────────


def _js_round(x: float) -> int:
    """Match JS ``Math.round`` (half away from zero) for non-negative inputs.

    Aggregated metrics here are counts/sums (>= 0), so ``floor(x + 0.5)`` is the
    exact equivalent. Python's built-in ``round`` uses banker's rounding and
    would diverge on .5 (e.g. 67.5 → 68 in JS, 68 here, but 68→... ``round`` 67.5
    gives 68 only by luck; ``round`` 2.5 gives 2). Always use this for parity.
    """
    return math.floor(x + 0.5)


def _js_string(v: Any) -> str:
    """Mirror JS ``String(v)`` for the value types that become dimension keys.

    Crucially: an integral float stringifies WITHOUT the trailing ``.0``
    (``String(5.0) === '5'``), and booleans are lowercase.
    """
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, float):
        if math.isfinite(v) and v == int(v):
            return str(int(v))
        return repr(v)
    return str(v)


def _num(v: Any) -> float | int:
    """JS Number()-ish coercion used only by the `computed:` metric path."""
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return math.nan


def _to_cumulative(values: list[float]) -> list[float]:
    """Running total (mirrors toCumulativeSeries in sparkline-visibility.ts)."""
    out: list[float] = []
    running: float = 0
    for v in values:
        running += v
        out.append(running)
    return out


def bucket_date(date_str: str, time_bucket: str) -> str:
    """Mirror `bucketDate` for the timezone-stable buckets. `hour` is viewer-local
    in the FE (`new Date(...).getHours()`) → refused. day/month are UTC string
    slices; week is the ISO-week Monday computed in UTC off the calendar day."""
    if not date_str:
        return "unknown"
    if time_bucket == "hour":
        raise NotAggregatable("hour bucket is viewer-local, not server-reproducible")
    if time_bucket == "day":
        return date_str[:10]
    if time_bucket == "week":
        d = datetime(int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10]), tzinfo=timezone.utc)
        js_day = (d.weekday() + 1) % 7  # Python Mon=0..Sun=6 → JS getUTCDay Sun=0..Sat=6
        to_monday = (-6 if js_day == 0 else 1) - js_day
        return (d + timedelta(days=to_monday)).strftime("%Y-%m-%d")
    # month (and any other value, matching the FE fallthrough)
    return date_str[:7]


# ─── Metric / dimension extraction (mirrors getMetricValue / getDimensionKeys) ──


def get_metric_value(post: dict, metric: str) -> float | int:
    if metric == "post_count":
        return 1
    if metric == "like_count":
        return post.get("like_count") or 0
    if metric == "view_count":
        return post.get("view_count") or 0
    if metric == "comment_count":
        return post.get("comment_count") or 0
    if metric == "share_count":
        return post.get("share_count") or 0
    if metric == "engagement_total":
        return (
            (post.get("like_count") or 0)
            + (post.get("comment_count") or 0)
            + (post.get("share_count") or 0)
        )
    if isinstance(metric, str) and metric.startswith(_COMPUTED_PREFIX):
        cid = metric[len(_COMPUTED_PREFIX):]
        v = (post.get("computed") or {}).get(cid)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return v
        n = _num(v if v is not None else 0)
        return n if (isinstance(n, (int, float)) and not math.isnan(n) and n) else 0
    # `customobj:` element tokens are object-list metrics (out of slice); the FE
    # returns 0 for any unrecognized metric here too.
    return 0


def get_dimension_keys(post: dict, dim: str, time_bucket: str | None = None) -> list[str]:
    """Categorical dimension values for one post. `posted_at` is bucketed by
    `time_bucket` (default day); cyclical local-tz dims raise NotAggregatable."""
    if isinstance(dim, str) and dim.startswith(_COMPUTED_PREFIX):
        cid = dim[len(_COMPUTED_PREFIX):]
        v = (post.get("computed") or {}).get(cid)
        return ["unknown" if v is None else _js_string(v)]
    if dim in _MULTIVALUED:
        arr = post.get(_MULTIVALUED[dim]) or []
        return list(arr) if arr else []
    if dim == "posted_at":
        return [bucket_date(post.get("posted_at") or "", time_bucket or "day")]
    if dim in _LOCAL_TZ_DIMS:
        raise NotAggregatable(f"cyclical dimension {dim!r} is viewer-local, not server-reproducible")
    if isinstance(dim, str) and dim.startswith(_CUSTOM_PREFIX):
        name = dim[len(_CUSTOM_PREFIX):]
        raw = (post.get("custom_fields") or {}).get(name)
        if raw is None:
            return []
        if isinstance(raw, list):
            # FE: keep non-null, non-object elements (typeof v !== 'object').
            return [
                _js_string(v)
                for v in raw
                if v is not None and not isinstance(v, (dict, list))
            ]
        if isinstance(raw, dict):
            return []
        return [_js_string(raw)]
    # Built-in scalar field: null/missing → 'unknown' (FE `?? 'unknown'`); an
    # empty string is a real value and is kept as ''.
    v = post.get(dim)
    return ["unknown" if v is None else _js_string(v)]


# ─── Stats accumulation (mirrors addToStats / resolveAgg / mergeStats) ──────────


def _new_stats() -> dict:
    return {"sum": 0, "count": 0, "min": math.inf, "max": -math.inf}


def _add_to_stats(acc: dict, key: str, val: float) -> None:
    cur = acc.get(key)
    if cur is None:
        cur = _new_stats()
        acc[key] = cur
    cur["sum"] += val
    cur["count"] += 1
    cur["min"] = min(cur["min"], val)
    cur["max"] = max(cur["max"], val)


def _merge_stats(a: dict, b: dict) -> dict:
    return {
        "sum": a["sum"] + b["sum"],
        "count": a["count"] + b["count"],
        "min": min(a["min"], b["min"]),
        "max": max(a["max"], b["max"]),
    }


def _resolve_agg(s: dict, metric_agg: str) -> float | int:
    if metric_agg == "avg":
        return _js_round(s["sum"] / s["count"]) if s["count"] > 0 else 0
    if metric_agg == "min":
        return 0 if s["min"] == math.inf else s["min"]
    if metric_agg == "max":
        return 0 if s["max"] == -math.inf else s["max"]
    if metric_agg == "count":
        return s["count"]
    return s["sum"]


def _median(vals: list[float]) -> float | int:
    if not vals:
        return 0
    s = sorted(vals)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


# ─── The aggregator (mirrors aggregateCustom: number-card + single-dim paths) ──


def compute_custom(
    posts: list[dict],
    config: dict,
    base_posts: list[dict] | None = None,
) -> dict:
    """Return the `WidgetData` dict for a categorical/number-card widget config.

    `base_posts` is the dashboard-scope baseline for the `percent` number-card
    (FE `basePosts`); defaults to `posts` (→ 100%), matching the share path where
    no dashboard-level filter narrows the set.
    """
    if base_posts is None:
        base_posts = posts

    dimension = config.get("dimension")
    metric = config.get("metric")
    metric_agg = config.get("metricAgg") or "sum"
    top_n = config.get("topN")
    include_others = config.get("includeOthers")
    breakdown = config.get("breakdownDimension")
    time_bucket = config.get("timeBucket") or "day"
    cumulative = bool(config.get("cumulative"))

    if isinstance(metric, str) and metric.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
        raise NotAggregatable("object-list / computed metrics are not in this slice")

    # ── Number-card (no dimension) ──────────────────────────────────────────
    if not dimension:
        if metric_agg == "count":
            return {"value": len(posts), "labels": ["Count"], "values": [len(posts)]}

        if metric_agg in ("distinct", "mode"):
            field = config.get("categoricalField")
            counts: dict[str, int] = {}
            if field:
                for p in posts:
                    for key in get_dimension_keys(p, field):
                        if key == "unknown":
                            continue
                        counts[key] = counts.get(key, 0) + 1
            if metric_agg == "distinct":
                return {"value": len(counts), "labels": ["Distinct"], "values": [len(counts)]}
            top_label, top_count, total = "", 0, 0
            for k, c in counts.items():
                total += c
                if c > top_count:
                    top_count, top_label = c, k
            return {
                "value": top_count,
                "stringValue": top_label,
                "valueTotal": total,
                "labels": [top_label],
                "values": [top_count],
            }

        vals = [get_metric_value(p, metric) for p in posts]
        if metric_agg == "percent":
            num = sum(vals)
            den = sum(get_metric_value(p, metric) for p in base_posts)
            pct = _js_round((num / den) * 1000) / 10 if den > 0 else 0
            return {"value": pct, "format": "percent", "labels": [metric], "values": [pct]}
        if metric_agg == "avg":
            value: float | int = _js_round(sum(vals) / len(vals)) if vals else 0
        elif metric_agg == "min":
            value = min(vals) if vals else 0
        elif metric_agg == "max":
            value = max(vals) if vals else 0
        elif metric_agg == "median":
            value = _median(vals)
        else:
            value = sum(vals)
        return {"value": value, "labels": [metric], "values": [value]}

    # ── Time series (posted_at; day/week/month only) ────────────────────────
    if dimension == "posted_at":
        if breakdown and breakdown != dimension:
            return _grouped_time_series(
                posts, breakdown, metric, metric_agg, time_bucket, top_n, include_others, cumulative
            )
        return _single_time_series(posts, metric, metric_agg, time_bucket, cumulative)

    if dimension in _LOCAL_TZ_DIMS:  # hour_of_day / day_of_week — viewer-local
        raise NotAggregatable(f"cyclical dimension {dimension!r} is not server-reproducible")

    if breakdown and breakdown != dimension:
        raise NotAggregatable("2D categorical pivot is not in this slice")

    # ── Single categorical dimension ────────────────────────────────────────
    acc: dict[str, dict] = {}
    for p in posts:
        val = get_metric_value(p, metric)
        for key in get_dimension_keys(p, dimension):
            _add_to_stats(acc, key, val)

    ranked = [
        {"label": label, "stats": s, "value": _resolve_agg(s, metric_agg)}
        for label, s in acc.items()
    ]
    # Stable sort, descending by value — matches V8's stable Array.prototype.sort
    # with insertion-order (first-seen) tie-break, since `acc` preserves
    # first-encounter order and Python's sort is stable.
    ranked.sort(key=lambda r: -r["value"])

    limit = top_n if top_n is not None else _DEFAULT_TOP_N
    top = ranked[:limit]
    tail = ranked[limit:]
    labels = [r["label"] for r in top]
    values = [r["value"] for r in top]

    if include_others and tail:
        merged = _new_stats()
        for r in tail:
            merged = _merge_stats(merged, r["stats"])
        labels.append("Others")
        values.append(_resolve_agg(merged, metric_agg))

    return {"value": sum(values), "labels": labels, "values": values}


def _single_time_series(
    posts: list[dict], metric: str, metric_agg: str, time_bucket: str, cumulative: bool
) -> dict:
    acc: dict[str, dict] = {}
    for p in posts:
        val = get_metric_value(p, metric)
        for key in get_dimension_keys(p, "posted_at", time_bucket):
            _add_to_stats(acc, key, val)
    # Chronological by label (ASCII ISO buckets sort lexicographically).
    resolved = sorted(
        ((label, _resolve_agg(s, metric_agg)) for label, s in acc.items()),
        key=lambda r: r[0],
    )
    base_values = [v for _, v in resolved]
    total = sum(base_values)  # per-bucket totals, even when the series is cumulative
    series_values = _to_cumulative(base_values) if cumulative else base_values
    return {
        "value": total,
        "labels": [label for label, _ in resolved],
        "values": series_values,
        "timeSeries": [
            {"date": resolved[i][0], "value": series_values[i]} for i in range(len(resolved))
        ],
    }


def _grouped_time_series(
    posts: list[dict], breakdown: str, metric: str, metric_agg: str,
    time_bucket: str, top_n: int | None, include_others: bool, cumulative: bool,
) -> dict:
    acc: dict[str, dict[str, dict]] = {}   # date → breakdownKey → Stats
    breakdown_totals: dict[str, float] = {}
    for p in posts:
        val = get_metric_value(p, metric)
        date_key = bucket_date(p.get("posted_at") or "", time_bucket)
        inner = acc.setdefault(date_key, {})
        for bk in get_dimension_keys(p, breakdown, time_bucket):
            _add_to_stats(inner, bk, val)
            breakdown_totals[bk] = breakdown_totals.get(bk, 0) + val

    all_dates = sorted(acc.keys())
    limit = top_n if top_n is not None else _DEFAULT_BREAKDOWN_LIMIT
    ranked = sorted(breakdown_totals.items(), key=lambda kv: -kv[1])
    top_keys = [k for k, _ in ranked[:limit]]
    tail_keys = [k for k, _ in ranked[limit:]]

    def accumulate(series: list[dict]) -> list[dict]:
        if not cumulative:
            return series
        running = _to_cumulative([d["value"] for d in series])
        return [{"date": series[i]["date"], "value": running[i]} for i in range(len(series))]

    grouped: dict[str, list[dict]] = {}
    for bk in top_keys:
        grouped[bk] = accumulate([
            {"date": d, "value": (_resolve_agg(acc[d][bk], metric_agg) if bk in acc[d] else 0)}
            for d in all_dates
        ])
    if include_others and tail_keys:
        others = []
        for d in all_dates:
            merged = _new_stats()
            any_ = False
            for bk in tail_keys:
                s = acc[d].get(bk)
                if s:
                    merged = _merge_stats(merged, s)
                    any_ = True
            others.append({"date": d, "value": (_resolve_agg(merged, metric_agg) if any_ else 0)})
        grouped["Others"] = accumulate(others)

    grand = 0
    for series in grouped.values():
        if cumulative:
            grand += series[-1]["value"] if series else 0
        else:
            grand += sum(pt["value"] for pt in series)
    return {"value": grand, "groupedTimeSeries": grouped}


# ─── Heatmap (2D pivot grid) — mirrors aggregateHeatmap, categorical axes only ──

_DEFAULT_HEATMAP_AXIS_LIMIT = 24


def _resolve_heatmap_axis(totals: dict[str, float], limit: int) -> list[str]:
    """Categorical heatmap axis: rank labels by total value descending (stable,
    first-seen tie-break — `totals` preserves insertion order, Python sort is
    stable, matching V8) and cap at `limit`. Cyclical axes are refused upstream
    (local-tz, not server-reproducible), so the canonical-order branch the FE
    keeps for hour_of_day/day_of_week is intentionally not implemented here."""
    return [k for k, _ in sorted(totals.items(), key=lambda kv: -kv[1])][:limit]


def compute_heatmap(posts: list[dict], config: dict) -> dict:
    """2D pivot for the heatmap chart type: `dimension` → X (columns),
    `breakdownDimension` → Y (rows/datasets), `metric`+`metricAgg` fill cells.
    Returns the `groupedCategorical` shape the heatmap renderer consumes.

    Categorical axes only. Time (`posted_at`) and cyclical (hour/weekday) axes
    are viewer-local or order-by-date and out of this slice → NotAggregatable so
    the caller keeps client aggregation.
    """
    x_dim = config.get("dimension")
    y_dim = config.get("breakdownDimension")
    metric = config.get("metric")
    metric_agg = config.get("metricAgg") or "sum"
    time_bucket = config.get("timeBucket") or "day"
    top_n = config.get("topN")

    if isinstance(metric, str) and metric.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
        raise NotAggregatable("object-list / computed heatmap metric is not in this slice")
    for d in (x_dim, y_dim):
        if d in _LOCAL_TZ_DIMS or d == "posted_at":
            raise NotAggregatable(f"heatmap axis {d!r} is not server-reproducible (this slice is categorical-only)")
        if isinstance(d, str) and d.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
            raise NotAggregatable("object/computed heatmap axis is not in this slice")
        if isinstance(d, str) and d.startswith(_CUSTOM_PREFIX) and "." in d[len(_CUSTOM_PREFIX):]:
            raise NotAggregatable("object-leaf heatmap axis is not in this slice")
    if config.get("timeBucket") == "hour":
        raise NotAggregatable("viewer-local hour bucket is not server-reproducible")

    single_row = ""
    acc: dict[str, dict[str, dict]] = {}      # xKey → yKey → Stats
    x_totals: dict[str, float] = {}
    y_totals: dict[str, float] = {}
    for p in posts:
        val = get_metric_value(p, metric)
        x_keys = get_dimension_keys(p, x_dim, time_bucket) if x_dim else [single_row]
        y_keys = get_dimension_keys(p, y_dim, time_bucket) if y_dim else [single_row]
        for xk in x_keys:
            inner = acc.setdefault(xk, {})
            for yk in y_keys:
                _add_to_stats(inner, yk, val)
                # FE increments BOTH totals once per (x,y) pair (inside the y loop).
                x_totals[xk] = x_totals.get(xk, 0) + val
                y_totals[yk] = y_totals.get(yk, 0) + val

    x_labels = _resolve_heatmap_axis(x_totals, top_n if top_n is not None else _DEFAULT_HEATMAP_AXIS_LIMIT)
    y_labels = (
        _resolve_heatmap_axis(y_totals, _DEFAULT_HEATMAP_AXIS_LIMIT) if y_dim else [single_row]
    )

    datasets = []
    for yk in y_labels:
        values = []
        for xk in x_labels:
            s = acc.get(xk, {}).get(yk)
            values.append(_resolve_agg(s, metric_agg) if s else 0)
        datasets.append({"label": yk, "values": values})

    value = sum(sum(ds["values"]) for ds in datasets)
    return {"value": value, "groupedCategorical": {"labels": x_labels, "datasets": datasets}}


def is_server_heatmap(widget: dict) -> bool:
    """True for heatmap widgets with CATEGORICAL axes (the aggregateHeatmap path).
    Refuses time/cyclical axes (viewer-local or order-by-date), object-leaf/object/
    computed dims+metrics, runtime metric toggles, and the topics source — those
    keep client-side aggregation, so `serverData` stays a strict superset."""
    if not isinstance(widget, dict):
        return False
    if widget.get("aggregation") != "custom" or widget.get("chartType") != "heatmap":
        return False
    if widget.get("dataSource") not in (None, "posts"):
        return False
    cfg = widget.get("customConfig")
    if not isinstance(cfg, dict):
        return False
    if not cfg.get("metric"):
        return False
    mt = cfg.get("metricToggle")
    if isinstance(mt, list) and len(mt) >= 2:
        return False
    if cfg.get("timeBucket") == "hour":
        return False
    metric = cfg.get("metric")
    if isinstance(metric, str) and metric.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
        return False
    for d in (cfg.get("dimension"), cfg.get("breakdownDimension")):
        if d is None:
            continue
        if d in _LOCAL_TZ_DIMS or d == "posted_at":
            return False
        if isinstance(d, str) and d.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
            return False
        if isinstance(d, str) and d.startswith(_CUSTOM_PREFIX) and "." in d[len(_CUSTOM_PREFIX):]:
            return False
    return True


# ─── Eligibility + per-layout fan-out (used by the share endpoint) ──────────────

# Custom chart types that route through aggregateCustom (the path mirrored above).
# Excludes `table`/`data-table` (aggregateTable — separate), `heatmap`
# (aggregateHeatmap — separate), and `embed` (post feed, not aggregation).
_CUSTOM_CHART_TYPES = {
    "bar", "pie", "doughnut", "line", "word-cloud", "number-card", "progress-list",
}


def is_server_aggregatable(widget: dict) -> bool:
    """True only for widgets this engine reproduces EXACTLY (the aggregateCustom
    path): categorical group-by + number-card + day/week/month time series, with
    or without per-widget filters. Deliberately conservative — runtime metric
    toggles, object-list/computed tokens, local-tz (hour/cyclical) dims,
    categorical 2D pivots, tables/heatmaps/embeds keep client-side aggregation,
    so the response stays a strict superset (`serverData` is opt-in per widget).
    """
    if not isinstance(widget, dict):
        return False
    if widget.get("aggregation") != "custom":
        return False
    if widget.get("dataSource") not in (None, "posts"):
        return False
    if widget.get("chartType") not in _CUSTOM_CHART_TYPES:
        return False
    cfg = widget.get("customConfig")
    if not isinstance(cfg, dict):
        return False

    # Viewer-facing metric toggle: the rendered metric can change at runtime, so
    # a single pre-computed series would be wrong once toggled.
    mt = cfg.get("metricToggle")
    if isinstance(mt, list) and len(mt) >= 2:
        return False

    dim = cfg.get("dimension")
    metric = cfg.get("metric")
    catf = cfg.get("categoricalField")
    bd = cfg.get("breakdownDimension")
    if not metric:
        return False
    if cfg.get("timeBucket") == "hour":  # viewer-local
        return False
    if dim in _LOCAL_TZ_DIMS:
        return False
    for tok in (dim, metric, catf):
        if isinstance(tok, str) and tok.startswith(_OBJECT_PREFIX):
            return False
    for tok in (dim, metric):
        if isinstance(tok, str) and tok.startswith(_COMPUTED_PREFIX):
            return False
    # Custom object-leaf dim/field (`custom:field.leaf`) is the list[object] slice.
    for tok in (dim, catf):
        if isinstance(tok, str) and tok.startswith(_CUSTOM_PREFIX) and "." in tok[len(_CUSTOM_PREFIX):]:
            return False
    # Breakdown (2nd dimension) is only reproduced for time series; a categorical
    # 2D pivot is a separate slice.
    if bd and bd != dim:
        if dim != "posted_at":
            return False
        if bd in _LOCAL_TZ_DIMS or bd == "posted_at":
            return False
        if isinstance(bd, str) and bd.startswith((_OBJECT_PREFIX, _COMPUTED_PREFIX)):
            return False
        if isinstance(bd, str) and bd.startswith(_CUSTOM_PREFIX) and "." in bd[len(_CUSTOM_PREFIX):]:
            return False
    return True


# ─── Group-table primitive (mirrors aggregateTable group mode) ──────────────────

_COMPOUND_SEP = "\x1f"  # COMPOUND_SEP in dashboard-aggregations.ts (ASCII unit sep)


def _is_dim_col(col: dict) -> bool:
    return col.get("kind") == "dimension"


def _is_postfield_col(col: dict) -> bool:
    return col.get("kind") == "post-field"


def _col_is_object(col: dict) -> bool:
    """A table column targeting a list[object] field (handled by the object slice)."""
    if _is_dim_col(col):
        d = col.get("dimension")
        return isinstance(d, str) and d.startswith(_CUSTOM_PREFIX) and "." in d[len(_CUSTOM_PREFIX):]
    m = col.get("metric")
    return isinstance(m, str) and m.startswith(_OBJECT_PREFIX)


def normalize_table_config(config: dict) -> dict:
    """Mirror normalizeTableConfig: hoist a legacy single `dimension` into a
    synthesized dimension column when no dimension columns are present."""
    cols = config.get("columns") or []
    if any(_is_dim_col(c) for c in cols):
        return config
    if not config.get("dimension"):
        return config
    seed = {"id": "__group_0", "kind": "dimension", "dimension": config["dimension"]}
    out = dict(config)
    out["columns"] = [seed, *cols]
    if config.get("sortBy") == "__dim":
        out["sortBy"] = "__group_0"
    return out


def table_primary_dimension(config: dict) -> str | None:
    for c in config.get("columns") or []:
        if _is_dim_col(c):
            return c.get("dimension")
    return None


def _compound_dimension_keys(post: dict, dim_cols: list[dict]) -> list[dict]:
    if not dim_cols:
        return [{"key": "__all__", "values": []}]
    combos = [{"key": "", "values": []}]
    for col in dim_cols:
        dim = col.get("dimension")
        if not dim:
            continue
        vs = get_dimension_keys(post, dim, "day")
        if not vs:
            return []
        nxt: list[dict] = []
        for combo in combos:
            for v in vs:
                nxt.append({
                    "key": v if combo["key"] == "" else combo["key"] + _COMPOUND_SEP + v,
                    "values": [*combo["values"], v],
                })
        combos = nxt
    return combos


def _table_sort(rows: list[dict], sort_key: str | None, sort_dir: str) -> None:
    if not sort_key:
        return
    direction = 1 if sort_dir == "asc" else -1

    def cmp(a: dict, b: dict) -> int:
        av = a.get(sort_key)
        bv = b.get(sort_key)
        if isinstance(av, str) or isinstance(bv, str):
            sa = str(av if av is not None else "")
            sb = str(bv if bv is not None else "")
            c = (sa > sb) - (sa < sb)
        else:
            na = av if isinstance(av, (int, float)) else 0
            nb = bv if isinstance(bv, (int, float)) else 0
            c = (na > nb) - (na < nb)
        return direction * c

    rows.sort(key=cmp_to_key(cmp))


def compute_table(posts: list[dict], raw_config: dict) -> list[dict]:
    """Group-mode table rows (mirrors aggregateTable). Raises NotAggregatable for
    post-mode (a bounded feed) and object-list tables (the object slice)."""
    config = normalize_table_config(raw_config)
    if config.get("mode") == "post":
        raise NotAggregatable("post-mode table is a bounded feed, not aggregation")
    columns = config.get("columns") or []
    if any(_col_is_object(c) for c in columns):
        raise NotAggregatable("object-list table is a separate slice")
    for c in columns:
        m = c.get("metric")
        if isinstance(m, str) and m.startswith(_COMPUTED_PREFIX):
            raise NotAggregatable("computed metric columns are not in this slice")

    sort_by = config.get("sortBy")
    sort_dir = config.get("sortDir", "desc")
    row_limit = config.get("rowLimit", 25)
    dim_cols = [c for c in columns if _is_dim_col(c)]
    channel_dim = next((c for c in dim_cols if c.get("dimension") == "channel_handle"), None)

    metric_acc: dict[str, dict[str, dict]] = {}
    dim_values_of: dict[str, list[str]] = {}
    platform_of: dict[str, str] = {}
    for p in posts:
        for combo in _compound_dimension_keys(p, dim_cols):
            key = combo["key"]
            per = metric_acc.get(key)
            if per is None:
                per = {}
                metric_acc[key] = per
                dim_values_of[key] = combo["values"]
            for col in columns:
                if _is_dim_col(col):
                    continue
                m = col.get("metric")
                if m:
                    _add_to_stats(per, col["id"], get_metric_value(p, m))
            if channel_dim and p.get("platform") and key not in platform_of:
                platform_of[key] = p["platform"]

    rows: list[dict] = []
    for key, per in metric_acc.items():
        row: dict = {"__key": key}
        if key in platform_of:
            row["__platform"] = platform_of[key]
        dim_values = dim_values_of.get(key, [])
        di = 0
        for col in columns:
            if _is_dim_col(col):
                row[col["id"]] = dim_values[di] if di < len(dim_values) else ""
                di += 1
            elif col.get("metric"):
                stats = per.get(col["id"]) or _new_stats()
                agg = "count" if col["metric"] == "post_count" else (col.get("agg") or "sum")
                row[col["id"]] = _resolve_agg(stats, agg)
        rows.append(row)

    _table_sort(rows, sort_by or (columns[0]["id"] if columns else None), sort_dir)
    return rows[:row_limit]


def build_widget_data_map(posts: list[dict], layout: list | None) -> dict[str, dict]:
    """Map widget id (`i`) → server-computed `WidgetData` for every eligible
    widget in a share layout. Reproduces the FE per-widget pipeline exactly:
    row-filter → value-filter → aggregate, with the percent baseline = the
    unfiltered set (`posts`). Skips anything outside the slice; never raises.

    `posts` must already be the dashboard-scope set (canonicalized, and — once
    scope filtering is ported — scope-narrowed). The caller skips this entirely
    when a reportScope is set, so `posts` is the full canonical set today.
    """
    # Local imports avoid circular dependencies (both modules import this one).
    from api.services.dashboard_object_aggregate import (
        compute_object_list,
        is_server_object_chart,
        object_field_of,
    )
    from api.services.dashboard_widget_filters import (
        apply_widget_filters,
        apply_widget_value_filters,
    )

    out: dict[str, dict] = {}
    for w in layout or []:
        wid = w.get("i") if isinstance(w, dict) else None
        if not wid:
            continue
        cfg = w.get("customConfig")
        filters = w.get("filters")
        try:
            if is_server_aggregatable(w):
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(per_widget, filters, cfg.get("dimension"))
                out[wid] = compute_custom(agg_posts, dict(cfg), posts)
            elif is_server_heatmap(w):
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(per_widget, filters, cfg.get("dimension"))
                out[wid] = compute_heatmap(agg_posts, dict(cfg))
            elif is_server_object_chart(w):
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(per_widget, filters, cfg.get("dimension"))
                out[wid] = compute_object_list(agg_posts, object_field_of(cfg), dict(cfg))
        except NotAggregatable:
            continue
    return out


def is_server_table(widget: dict) -> bool:
    """True for group-mode, non-object table widgets sorted by a NUMERIC (metric)
    column. String-sorted tables are excluded because JS `localeCompare` is
    locale-dependent (not even stable across the client's own users), so exact
    server parity isn't guaranteed there — they keep client-side aggregation."""
    if not isinstance(widget, dict):
        return False
    if widget.get("aggregation") != "custom" or widget.get("chartType") != "table":
        return False
    if widget.get("dataSource") not in (None, "posts"):
        return False
    tc = widget.get("tableConfig")
    if not isinstance(tc, dict):
        return False
    config = normalize_table_config(tc)
    if config.get("mode") == "post":
        return False
    if config.get("breakdownDimension"):
        return False
    columns = config.get("columns") or []
    if not columns or any(_col_is_object(c) for c in columns):
        return False
    if any(isinstance(c.get("metric"), str) and c["metric"].startswith(_COMPUTED_PREFIX) for c in columns):
        return False
    # Object-leaf / cyclical dim columns aren't reproducible here.
    for c in columns:
        if not _is_dim_col(c):
            continue
        d = c.get("dimension")
        if d in _LOCAL_TZ_DIMS:
            return False
    # The resolved sort column must be a metric (numeric) column.
    sort_key = config.get("sortBy") or columns[0].get("id")
    sort_col = next((c for c in columns if c.get("id") == sort_key), None)
    if sort_col is None or _is_dim_col(sort_col) or _is_postfield_col(sort_col):
        return False
    return True


def build_table_data_map(posts: list[dict], layout: list | None) -> dict[str, list[dict]]:
    """Map widget id (`i`) → server-computed table rows for every eligible
    group-table widget. Same per-widget pipeline as charts (row + value filter)."""
    from api.services.dashboard_object_aggregate import (
        compute_object_table,
        is_server_object_table,
        object_field_of_table,
    )
    from api.services.dashboard_widget_filters import (
        apply_widget_filters,
        apply_widget_value_filters,
    )

    out: dict[str, list[dict]] = {}
    for w in layout or []:
        wid = w.get("i") if isinstance(w, dict) else None
        if not wid:
            continue
        tc = w.get("tableConfig")
        filters = w.get("filters")
        try:
            if is_server_table(w):
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(
                    per_widget, filters, table_primary_dimension(normalize_table_config(tc))
                )
                out[wid] = compute_table(agg_posts, tc)
            elif is_server_object_table(w):
                norm = normalize_table_config(tc)
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(
                    per_widget, filters, table_primary_dimension(norm)
                )
                out[wid] = compute_object_table(agg_posts, object_field_of_table(norm), tc)
        except NotAggregatable:
            continue
    return out


# ─── Bounded post feed + whole-layout coverage gate (slice 7) ───────────────────

_DEFAULT_EMBED_RANK = "view_count"
_DEFAULT_EMBED_COUNT = 8
_MAX_EMBED_COUNT = 30


def _embed_metric_value(post: dict, rank_by: str) -> float:
    if rank_by == "view_count":
        return post.get("view_count") or 0
    if rank_by == "like_count":
        return post.get("like_count") or 0
    if rank_by == "comment_count":
        return post.get("comment_count") or 0
    if rank_by == "share_count":
        return post.get("share_count") or 0
    if rank_by == "engagement_total":
        return (post.get("like_count") or 0) + (post.get("comment_count") or 0) + (post.get("share_count") or 0)
    if rank_by == "recent":
        raw = post.get("posted_at")
        if not raw:
            return 0
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0
    return 0


def _resolve_embed_count(count: Any) -> int:
    if not isinstance(count, (int, float)) or not math.isfinite(count):
        return _DEFAULT_EMBED_COUNT
    return max(1, min(_MAX_EMBED_COUNT, math.floor(count)))


def compute_embed_posts(posts: list[dict], embed_config: dict | None) -> list[dict]:
    """Mirror resolveEmbedPosts: rank by metric (desc, stable on ties), drop posts
    without a usable post_url, take top-N, remove manually-hidden ids."""
    cfg = embed_config or {}
    rank_by = cfg.get("rankBy") or _DEFAULT_EMBED_RANK
    count = _resolve_embed_count(cfg.get("count"))
    hidden = set(cfg.get("hiddenPostIds") or [])
    usable = [p for p in posts if isinstance(p.get("post_url"), str) and p["post_url"].strip()]
    ranked = sorted(
        enumerate(usable),
        key=lambda pair: (-_embed_metric_value(pair[1], rank_by), pair[0]),
    )
    candidates = [p for _, p in ranked][:count]
    return [p for p in candidates if p.get("post_id") not in hidden]


def _is_feed_widget(widget: dict) -> bool:
    """A widget that renders a bounded set of actual posts (server-resolvable)."""
    return (
        widget.get("aggregation") == "embeds"
        and (widget.get("embedConfig") or {}).get("source") == "collection"
    )


# Post-mode table feed (#5): a post-mode table renders one row per post, sliced
# to `rowLimit` after sorting. The SELECTION (which posts) is server-reproducible
# only when the sort column is a NUMERIC post-field — JS `localeCompare` on string
# columns is locale-dependent (mirrors the is_server_table numeric-sort rule).
_POST_FIELD_NUMERIC = {
    "like_count", "view_count", "comment_count", "share_count", "engagement_total",
}
_DEFAULT_POST_TABLE_ROW_LIMIT = 50


def _post_field_numeric_value(post: dict, field: str) -> float:
    if field == "engagement_total":
        return (post.get("like_count") or 0) + (post.get("comment_count") or 0) + (post.get("share_count") or 0)
    return post.get(field) or 0


def _post_table_sort_field(config: dict) -> str | None:
    """The post-field the table sorts by, if it's a numeric (reproducible) column.
    Returns None when post-mode sorts by a string/array column (localeCompare —
    not server-reproducible) or by a non-post-field column."""
    columns = config.get("columns") or []
    if not columns:
        return None
    sort_key = config.get("sortBy") or columns[0].get("id")
    col = next((c for c in columns if c.get("id") == sort_key), None)
    if col is None or not _is_postfield_col(col):
        return None
    pf = col.get("postField")
    return pf if pf in _POST_FIELD_NUMERIC else None


def is_server_post_table_feed(widget: dict) -> bool:
    """True for a post-mode table whose bounded row set is server-reproducible
    (numeric sort). Such a table ships as a feed (post-id list) like an embed."""
    if not isinstance(widget, dict):
        return False
    if widget.get("aggregation") != "custom" or widget.get("chartType") != "table":
        return False
    if widget.get("dataSource") not in (None, "posts"):
        return False
    tc = widget.get("tableConfig")
    if not isinstance(tc, dict):
        return False
    config = normalize_table_config(tc)
    if config.get("mode") != "post":
        return False
    return _post_table_sort_field(config) is not None


def compute_post_table_feed(posts: list[dict], raw_config: dict) -> list[dict]:
    """Bounded post set a post-mode table displays: sort by the numeric sort
    column (stable, matching JS `Array.sort` tie-order), slice to `rowLimit`.
    Mirrors aggregateTablePostMode's SELECTION (the FE re-renders rows from these
    posts). Raises NotAggregatable for a non-numeric sort (localeCompare)."""
    config = normalize_table_config(raw_config)
    if config.get("mode") != "post":
        raise NotAggregatable("not a post-mode table")
    field = _post_table_sort_field(config)
    if field is None:
        raise NotAggregatable("post-mode table sort is not a numeric (reproducible) column")
    sort_dir = config.get("sortDir", "desc")
    row_limit = config.get("rowLimit", _DEFAULT_POST_TABLE_ROW_LIMIT)
    # Stable sort; reverse for desc keeps original order on ties (matches a JS
    # comparator returning 0 for equal values).
    ordered = sorted(posts, key=lambda p: _post_field_numeric_value(p, field), reverse=(sort_dir != "asc"))
    return ordered[:row_limit]


def is_static_widget(widget: dict) -> bool:
    """A widget with NO post-data dependency (renders from its own config)."""
    agg = widget.get("aggregation")
    if agg in ("text", "media"):
        return True
    # Embeds in URL mode embed fixed URLs, not collection posts.
    if agg == "embeds" and (widget.get("embedConfig") or {}).get("source") != "collection":
        return True
    return False


def build_feed_data_map(posts: list[dict], layout: list | None) -> dict[str, list[dict]]:
    """Map widget id → the bounded ordered posts a feed (embeds) widget displays.
    Applies the same row/value filter pipeline as other widgets."""
    from api.services.dashboard_widget_filters import (
        apply_widget_filters,
        apply_widget_value_filters,
    )

    out: dict[str, list[dict]] = {}
    for w in layout or []:
        if not isinstance(w, dict):
            continue
        wid = w.get("i")
        if not wid:
            continue
        filters = w.get("filters")
        try:
            if _is_feed_widget(w):
                per_widget = apply_widget_filters(posts, filters)
                agg_posts = apply_widget_value_filters(per_widget, filters, None)
                out[wid] = compute_embed_posts(agg_posts, w.get("embedConfig"))
            elif is_server_post_table_feed(w):
                # Post-mode table: render one row per post over the row-filtered
                # set (no value filter — post mode shows raw posts), bounded to
                # rowLimit by the numeric sort. The FE re-renders rows from these.
                per_widget = apply_widget_filters(posts, filters)
                out[wid] = compute_post_table_feed(per_widget, w.get("tableConfig"))
        except NotAggregatable:
            continue
    return out


def layout_fully_covered(
    layout: list | None,
    widget_data: dict,
    table_data: dict,
    feed_data: dict,
) -> bool:
    """True when EVERY widget is server-satisfied — covered by an aggregated
    series/table, resolved as a bounded feed, or static (no post dependency).
    Only then is it safe to omit the full posts array from the share payload."""
    widgets = [w for w in (layout or []) if isinstance(w, dict)]
    if not widgets:
        return False
    for w in widgets:
        wid = w.get("i")
        if wid and (wid in widget_data or wid in table_data or wid in feed_data):
            continue
        if is_static_widget(w):
            continue
        return False
    return True
