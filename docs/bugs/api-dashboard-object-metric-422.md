# api — saving an object-list widget 422s on `customobj:` metrics

## Repro
1. Dashboard widget editor → Aggregate → an object field (`list[object]`, e.g. `brand_objects`).
2. Pick any object metric (count, distinct posts, own leaf, or inherited post metric) in a chart or table widget.
3. Click Done. Save POST fails **422** with `literal_error` on `customConfig.metric` /
   `tableConfig.columns[].metric`, e.g. input `customobj:brand_objects.__count` not in the
   `CustomMetric` / `TopicMetric` Literal sets.

## Root cause
`AnyMetric` in [api/routers/dashboard_schema.py](../../api/routers/dashboard_schema.py) was
`Union[CustomMetric, TopicMetric]` — both strict `Literal`s. Object-list element metrics use a
dynamic `customobj:<field>.<suffix>` namespace (mirrors the TS `\`customobj:${string}\`` arm of
`CustomMetric`). The `custom:` *dimension* prefix already had a pattern arm
(`CustomFieldDimension`), but the `customobj:` *metric* prefix had none, so it was never accepted.
Pre-existing gap in the list[object] initiative — even `customobj:men.age` would have 422'd.

## Fix
Added `CustomObjectMetric = Annotated[str, StringConstraints(pattern=r"^customobj:[^\s]+$")]`
and widened `AnyMetric = Union[CustomMetric, TopicMetric, CustomObjectMetric]`. The Python
`CustomMetric` Literal is unchanged, so the parity test (`test_custom_metric_matches`) still holds
— same pattern as `CustomFieldDimension` / `CustomDimension`.

## Regression test
`api/tests/test_dashboard_schema_parity.py::test_custom_config_accepts_object_element_metrics`
(round-trips count / `__posts` / own leaf / inherited `post.view_count` on chart + table configs).

## Commit
Working tree (uncommitted) alongside the frontend object-metric-inheritance feature.
