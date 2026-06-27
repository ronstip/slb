"""Migration mapping: legacy alert dict → watch create-data shape.

Pins the load-bearing field moves so a migrated alert keeps emailing the same
recipients with the same charts, fired on run completion — and that widgets land
under `action` (where the Watch schema + render path read them)."""

from __future__ import annotations

from scripts.migrate_alerts_to_watches import _alert_to_watch


def _alert(**over):
    base = {
        "alert_id": "al1",
        "name": "Nike negatives",
        "user_id": "u1",
        "org_id": "org1",
        "agent_id": "ag1",
        "filters": {"sentiment": ["negative"], "brands": ["Nike"]},
        "recipients": ["a@x.com", "b@x.com"],
        "widgets": [{"i": "w1", "aggregation": "sentiment", "chartType": "doughnut", "title": "S"}],
        "enabled": True,
    }
    base.update(over)
    return base


def test_maps_core_fields():
    w = _alert_to_watch(_alert())
    assert w["name"] == "Nike negatives"
    assert w["owner_uid"] == "u1"
    assert w["eval_on"] == "run"
    assert w["legacy_alert_id"] == "al1"
    assert w["subject"] == {"mode": "agents", "agent_ids": ["ag1"], "grain": "per_agent"}
    # structured event trigger over the alert's filters
    s = w["trigger"]["structured"]
    assert s["scope"] == {"sentiment": ["negative"], "brands": ["Nike"]}
    assert s["measure"]["reducer"] == "count" and s["compare"] == {"op": ">=", "threshold": 1}


def test_widgets_and_recipients_under_action():
    w = _alert_to_watch(_alert())
    action = w["action"]
    assert action["channels"] == ["email"]
    assert action["recipients"] == ["a@x.com", "b@x.com"]
    assert action["include_widgets"] is True
    assert action["widgets"] == [{"i": "w1", "aggregation": "sentiment", "chartType": "doughnut", "title": "S"}]
    # widgets must NOT be left at the top level (the Watch schema reads action.widgets)
    assert "widgets" not in w


def test_no_widgets_disables_include():
    w = _alert_to_watch(_alert(widgets=[]))
    assert w["action"]["include_widgets"] is False
    assert w["action"]["widgets"] == []
