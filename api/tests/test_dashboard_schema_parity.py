"""Schema parity between frontend TS types and backend Pydantic models.

The agent-composed dashboard feature has two sources of truth:
  - `frontend/src/features/studio/dashboard/types-social-dashboard.ts`
  - `api/routers/dashboard_schema.py`

If they drift, the agent will produce layouts the frontend can't render.
This test extracts enum literal sets from the TS file via regex and asserts
they match the Python `Literal[...]` sets.
"""

import re
from pathlib import Path
from typing import get_args

import pytest

from api.routers.dashboard_schema import (
    AGGREGATION_DEFAULTS,
    VALID_CHART_TYPES,
    CustomDimension,
    CustomMetric,
    SocialAggregation,
    SocialChartType,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_FILE = REPO_ROOT / "frontend/src/features/studio/dashboard/types-social-dashboard.ts"


def _ts_source() -> str:
    assert TS_FILE.exists(), f"TS types file not found: {TS_FILE}"
    return TS_FILE.read_text()


def _extract_union(ts: str, type_name: str) -> set[str]:
    """Parse `export type FOO = | 'a' | 'b' | ...;` and return the set of literals."""
    m = re.search(rf"export type {re.escape(type_name)}\s*=\s*([^;]+);", ts)
    assert m, f"Could not find `export type {type_name}` in TS source"
    literals = re.findall(r"'([^']+)'", m.group(1))
    assert literals, f"No literals found in {type_name}"
    return set(literals)


def _extract_valid_chart_types(ts: str) -> dict[str, set[str]]:
    """Parse the VALID_CHART_TYPES record."""
    m = re.search(
        r"export const VALID_CHART_TYPES[^{]+\{([^}]+)\}",
        ts,
        re.DOTALL,
    )
    assert m, "Could not find VALID_CHART_TYPES in TS source"
    body = m.group(1)
    result: dict[str, set[str]] = {}
    for line in body.splitlines():
        entry = re.match(r"\s*'([^']+)':\s*\[([^\]]*)\]", line)
        if not entry:
            continue
        agg = entry.group(1)
        types = set(re.findall(r"'([^']+)'", entry.group(2)))
        result[agg] = types
    return result


def test_social_aggregation_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "SocialAggregation")
    py_set = set(get_args(SocialAggregation))
    assert ts_set == py_set, (
        f"SocialAggregation drift — TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_social_chart_type_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "SocialChartType")
    py_set = set(get_args(SocialChartType))
    assert ts_set == py_set, (
        f"SocialChartType drift — TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_custom_dimension_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "CustomDimension")
    py_set = set(get_args(CustomDimension))
    assert ts_set == py_set


def test_custom_metric_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "CustomMetric")
    py_set = set(get_args(CustomMetric))
    assert ts_set == py_set


def test_valid_chart_types_matches():
    ts = _ts_source()
    ts_map = _extract_valid_chart_types(ts)
    py_map = {k: set(v) for k, v in VALID_CHART_TYPES.items()}
    assert ts_map.keys() == py_map.keys(), (
        f"VALID_CHART_TYPES key drift — TS only: {ts_map.keys() - py_map.keys()}, "
        f"Python only: {py_map.keys() - ts_map.keys()}"
    )
    for agg, ts_types in ts_map.items():
        assert ts_types == py_map[agg], (
            f"VALID_CHART_TYPES['{agg}'] drift — TS: {ts_types}, Python: {py_map[agg]}"
        )


def test_aggregation_defaults_covers_all_aggregations():
    py_set = set(get_args(SocialAggregation))
    assert set(AGGREGATION_DEFAULTS.keys()) == py_set, (
        "AGGREGATION_DEFAULTS must have an entry for every SocialAggregation"
    )


def test_aggregation_defaults_chart_types_are_valid():
    for agg, defaults in AGGREGATION_DEFAULTS.items():
        chart_type = defaults["chartType"]
        assert chart_type in VALID_CHART_TYPES[agg], (
            f"AGGREGATION_DEFAULTS['{agg}'].chartType='{chart_type}' "
            f"not in VALID_CHART_TYPES['{agg}']={VALID_CHART_TYPES[agg]}"
        )
