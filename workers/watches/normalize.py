"""Coerce a BigQuery scope_posts row into the dict shape the filter/detector
expect. Lives here (not under workers/alerts, which is being deleted) and is
shared by the watch reader (runner.py), preview (watch_service), and the
watch-render endpoint.

The dashboard read path runs each row through `assemble_dashboard_core`, which
parses JSON-typed columns; the watch path skips that, so we normalize the few
fields the filter engine reads: array dims must be lists and `custom_fields`
must be a dict (BigQuery JSON may arrive as a string).
"""

from __future__ import annotations

import json

_LIST_FIELDS = ("themes", "entities", "detected_brands", "topic_ids")


def normalize_post(row: dict) -> dict:
    post = dict(row)
    for f in _LIST_FIELDS:
        v = post.get(f)
        if v is None:
            post[f] = []
        elif not isinstance(v, list):
            post[f] = [v]
    cf = post.get("custom_fields")
    if isinstance(cf, str):
        try:
            cf = json.loads(cf)
        except (json.JSONDecodeError, TypeError):
            cf = None
    if not isinstance(cf, dict):
        cf = {}
    post["custom_fields"] = cf
    return post
