"""Dynamic per-agent email alerts: schema validation, CRUD + access control,
the agent NL tool, and the collection-completion evaluator (match + dedup).

Filter evaluation is the dashboard engine reused verbatim, so these tests focus
on the alert wiring around it, not on re-proving operator semantics (that's
covered by the dashboard parity suite).
"""

from __future__ import annotations

import pytest

from api.auth.dependencies import CurrentUser


def _user(uid="owner", org_id=None, email=None):
    return CurrentUser(
        uid=uid, email=email or f"{uid}@x.com", display_name=uid, org_id=org_id, org_role="member"
    )


# ── in-memory Firestore fake ─────────────────────────────────────────────


class FakeFS:
    def __init__(self):
        self.alerts: dict[str, dict] = {}
        self.seen: dict[str, set] = {}  # alert_id -> set(post_id)
        self.agents: dict[str, dict] = {}
        self.collections: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        self.updates: list[tuple] = []

    # agents / collections / users
    def get_agent(self, agent_id):
        return self.agents.get(agent_id)

    def get_collection_status(self, cid):
        return self.collections.get(cid)

    def get_user(self, uid):
        return self.users.get(uid)

    # alerts
    def create_alert(self, alert_id, data):
        d = dict(data)
        d.setdefault("trigger_count", 0)
        d.setdefault("enabled", True)
        d["created_at"] = "2026-06-22T00:00:00+00:00"
        d["updated_at"] = d["created_at"]
        self.alerts[alert_id] = d

    def get_alert(self, alert_id):
        d = self.alerts.get(alert_id)
        if d is None:
            return None
        out = dict(d)
        out["alert_id"] = alert_id
        return out

    def list_alerts_for_agent(self, agent_id):
        return [self.get_alert(aid) for aid, d in self.alerts.items() if d.get("agent_id") == agent_id]

    def list_enabled_alerts_for_agent(self, agent_id):
        return [
            self.get_alert(aid)
            for aid, d in self.alerts.items()
            if d.get("agent_id") == agent_id and d.get("enabled")
        ]

    def update_alert(self, alert_id, **fields):
        self.alerts[alert_id].update(fields)
        self.updates.append((alert_id, fields))

    def delete_alert(self, alert_id):
        self.alerts.pop(alert_id, None)
        self.seen.pop(alert_id, None)

    def filter_unseen_post_ids(self, alert_id, post_ids):
        seen = self.seen.get(alert_id, set())
        out, dedup = [], set()
        for pid in post_ids:
            if pid in dedup or pid in seen:
                continue
            dedup.add(pid)
            out.append(pid)
        return out

    def mark_posts_alerted(self, alert_id, post_ids):
        self.seen.setdefault(alert_id, set()).update(post_ids)


class FakeBQ:
    def __init__(self, rows):
        self.rows = rows

    def query(self, sql, params=None):
        return [dict(r) for r in self.rows]


def _post(post_id, sentiment="negative", content="text", **extra):
    p = {
        "post_id": post_id,
        "collection_id": "c1",
        "platform": "twitter",
        "channel_handle": "nike",
        "posted_at": "2026-06-20T10:00:00",
        "title": "",
        "content": content,
        "post_url": f"https://x.com/{post_id}",
        "sentiment": sentiment,
        "emotion": "anger",
        "themes": [],
        "entities": [],
        "detected_brands": ["Nike"],
        "language": "en",
        "content_type": "post",
        "channel_type": "ugc",
        "topic_ids": [],
        "like_count": 5,
        "view_count": 0,
        "comment_count": 0,
        "share_count": 0,
        "custom_fields": {},
    }
    p.update(extra)
    return p


# ── schema validation ─────────────────────────────────────────────────────


def test_alert_create_validates_and_dedups_recipients():
    from api.schemas.alerts import AlertCreate

    a = AlertCreate(
        name="  Nike  ",
        filters={"sentiment": ["negative"]},
        recipients=["a@x.com", "A@x.com", "b@x.com"],
        max_items_per_email=999,
    )
    assert a.name == "Nike"
    assert a.recipients == ["a@x.com", "b@x.com"]  # case-insensitive dedup
    assert a.max_items_per_email == 50  # clamped


def test_alert_create_rejects_bad_email_and_overflow():
    from api.schemas.alerts import AlertCreate

    with pytest.raises(Exception):
        AlertCreate(name="x", recipients=["not-an-email"])
    with pytest.raises(Exception):
        AlertCreate(name="x", recipients=[f"u{i}@x.com" for i in range(21)])


def _widget(i="w1", aggregation="sentiment", chart_type="pie", title="Sentiment"):
    return {
        "i": i,
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": aggregation,
        "chartType": chart_type,
        "title": title,
    }


def test_alert_create_accepts_and_caps_widgets():
    from api.schemas.alerts import MAX_WIDGETS_PER_ALERT, AlertCreate

    a = AlertCreate(name="Viz", widgets=[_widget("w1"), _widget("w2", "platform", "bar", "By platform")])
    assert len(a.widgets) == 2
    assert a.widgets[0].chartType == "pie"
    assert a.widgets[1].aggregation == "platform"

    # Default: no widgets → legacy text email path.
    assert AlertCreate(name="None").widgets == []

    # Over the cap is rejected.
    with pytest.raises(Exception):
        AlertCreate(name="x", widgets=[_widget(f"w{i}") for i in range(MAX_WIDGETS_PER_ALERT + 1)])


# ── CRUD + access control ──────────────────────────────────────────────────


@pytest.fixture
def fs(monkeypatch):
    fake = FakeFS()
    fake.agents["agent1"] = {"user_id": "owner", "org_id": None, "collection_ids": ["c1"]}
    from api.services import alert_service

    monkeypatch.setattr(alert_service, "get_fs", lambda: fake)
    return fake


def test_create_and_list_alert(fs):
    from api.schemas.alerts import AlertCreate
    from api.services import alert_service

    created = alert_service.create_alert(
        _user(), "agent1", AlertCreate(name="Neg", filters={"sentiment": ["negative"]})
    )
    assert created["name"] == "Neg"
    assert created["recipients"] == ["owner@x.com"]  # defaulted to owner email
    assert created["created_by"] == "user"

    alerts = alert_service.list_alerts(_user(), "agent1")
    assert len(alerts) == 1


def test_create_and_update_alert_persists_widgets(fs):
    from api.schemas.alerts import AlertCreate, AlertUpdate
    from api.services import alert_service

    created = alert_service.create_alert(
        _user(), "agent1", AlertCreate(name="Viz", widgets=[_widget("w1")])
    )
    assert created["widgets"][0]["i"] == "w1"
    assert created["widgets"][0]["chartType"] == "pie"

    aid = created["alert_id"]
    updated = alert_service.update_alert(
        _user(), aid, AlertUpdate(widgets=[_widget("w2", "platform", "bar", "Plat")])
    )
    assert [w["i"] for w in updated["widgets"]] == ["w2"]

    # Clearing widgets (explicit empty list) reverts to the text email path.
    cleared = alert_service.update_alert(_user(), aid, AlertUpdate(widgets=[]))
    assert cleared["widgets"] == []


def test_access_denied_for_non_owner(fs):
    from fastapi import HTTPException

    from api.schemas.alerts import AlertCreate
    from api.services import alert_service

    with pytest.raises(HTTPException) as ei:
        alert_service.create_alert(_user(uid="intruder"), "agent1", AlertCreate(name="x"))
    assert ei.value.status_code == 403


def test_update_and_delete_alert(fs):
    from api.schemas.alerts import AlertCreate, AlertUpdate
    from api.services import alert_service

    created = alert_service.create_alert(_user(), "agent1", AlertCreate(name="A"))
    aid = created["alert_id"]

    updated = alert_service.update_alert(_user(), aid, AlertUpdate(enabled=False, name="B"))
    assert updated["enabled"] is False
    assert updated["name"] == "B"

    alert_service.delete_alert(_user(), aid)
    assert fs.get_alert(aid) is None


# ── agent NL tool ───────────────────────────────────────────────────────────


class _Ctx:
    def __init__(self, state):
        self.state = state


def test_agent_tool_create_alert(monkeypatch):
    fake = FakeFS()
    fake.agents["agent1"] = {"user_id": "owner", "org_id": None, "collection_ids": ["c1"]}
    fake.users["owner"] = {"email": "owner@x.com"}
    import api.deps as deps
    from api.services import alert_service
    from api.agent.tools import manage_alerts

    monkeypatch.setattr(alert_service, "get_fs", lambda: fake)
    monkeypatch.setattr(deps, "get_fs", lambda: fake)

    ctx = _Ctx({"user_id": "owner", "active_agent_id": "agent1"})
    res = manage_alerts.create_alert(
        name="Nike recalls",
        filters={"sentiment": ["negative"], "conditions": [{"field": "text", "operator": "contains", "value": "recall"}]},
        tool_context=ctx,
    )
    assert res["status"] == "success"
    assert fake.list_alerts_for_agent("agent1")


def test_agent_tool_requires_active_agent():
    from api.agent.tools import manage_alerts

    res = manage_alerts.create_alert(name="x", filters={}, tool_context=_Ctx({"user_id": "u"}))
    assert res["status"] == "error"


# ── test-send error surfacing ───────────────────────────────────────────────


def test_test_email_surfaces_failure_reason(fs, monkeypatch):
    """A failed test-send must report WHY (not an opaque 502).

    Repro of SCOLTO-BACKEND-Z / -4 / FRONTEND-X: SendGrid returned 401, the
    channel swallowed it to ``status=error`` with a reason, but send_test_email
    collapsed every failure into the bare detail "Failed to send test email.",
    sending the user to debug alert logic instead of the SendGrid key.
    """
    from fastapi import HTTPException

    import workers.notifications.service as svc
    from api.schemas.alerts import AlertCreate
    from api.services import alert_service

    created = alert_service.create_alert(
        _user(), "agent1", AlertCreate(name="Neg", filters={"sentiment": ["negative"]})
    )
    aid = created["alert_id"]

    import config.settings as cfg

    monkeypatch.setattr(cfg, "get_settings", lambda: type("S", (), {"frontend_url": ""})())
    monkeypatch.setattr(
        alert_service,
        "preview_alert",
        lambda *a, **k: {"matched_count": 0, "scanned_count": 0, "sample": []},
    )
    monkeypatch.setattr(
        svc,
        "send_composed_html_email",
        lambda **k: {"status": "error", "message": "Email is not configured. SendGrid API key is missing."},
    )

    with pytest.raises(HTTPException) as ei:
        alert_service.send_test_email(_user(), aid)
    assert ei.value.status_code == 502
    assert "SendGrid" in ei.value.detail  # underlying reason surfaced, not swallowed


# ── render token (headless embed auth) ──────────────────────────────────────


@pytest.fixture
def _render_secret(monkeypatch):
    import config.settings as cfg
    from workers.alerts import render_token

    monkeypatch.setattr(
        render_token, "get_settings", lambda: type("S", (), {"alert_render_secret": "test-secret"})()
    )
    return render_token


def test_render_token_roundtrips(_render_secret):
    tok = _render_secret.mint_render_token("alert-1", 2)
    assert _render_secret.verify_render_token(tok) == ("alert-1", 2)


def test_render_token_rejects_tamper(_render_secret):
    tok = _render_secret.mint_render_token("alert-1", 0)
    body, sig = tok.split(".")
    with pytest.raises(_render_secret.RenderTokenError):
        _render_secret.verify_render_token(f"{body}x.{sig}")  # tampered payload


def test_render_token_rejects_expired(_render_secret):
    tok = _render_secret.mint_render_token("alert-1", 0, ttl_seconds=-1)
    with pytest.raises(_render_secret.RenderTokenError):
        _render_secret.verify_render_token(tok)


# ── evaluator: match, email, dedup ──────────────────────────────────────────


@pytest.fixture
def captured_emails(monkeypatch):
    sent = []
    import workers.notifications.service as svc

    def fake_send(recipient_email, subject, body_html):
        sent.append({"to": recipient_email, "subject": subject, "body": body_html})
        return {"status": "success", "message": "ok"}

    # Alert emails (visual + post-feed fallback) both go out as HTML.
    monkeypatch.setattr(svc, "send_composed_html_email", fake_send)
    return sent


def _eval_fs():
    fake = FakeFS()
    fake.collections["c1"] = {"agent_id": "agent1", "user_id": "owner", "org_id": None}
    fake.users["owner"] = {"email": "owner@x.com"}
    fake.alerts["al1"] = {
        "agent_id": "agent1",
        "user_id": "owner",
        "name": "Negative Nike",
        "enabled": True,
        "filters": {"sentiment": ["negative"]},
        "recipients": ["owner@x.com"],
        "max_items_per_email": 10,
        "trigger_count": 0,
    }
    return fake


def test_evaluator_matches_and_emails(captured_emails):
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    fake = _eval_fs()
    bq = FakeBQ([_post("p1", "negative"), _post("p2", "positive"), _post("p3", "negative")])

    summary = evaluate_alerts_for_collection("c1", bq=bq, fs=fake)

    assert summary["alerts_triggered"] == 1
    assert len(captured_emails) == 1
    assert "2 new" in captured_emails[0]["subject"]
    assert fake.seen["al1"] == {"p1", "p3"}
    assert fake.alerts["al1"]["trigger_count"] == 1


def test_evaluator_dedups_across_runs(captured_emails):
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    fake = _eval_fs()
    bq = FakeBQ([_post("p1", "negative")])

    evaluate_alerts_for_collection("c1", bq=bq, fs=fake)
    assert len(captured_emails) == 1

    # Same post re-collected in a later run must NOT re-alert.
    evaluate_alerts_for_collection("c1", bq=bq, fs=fake)
    assert len(captured_emails) == 1


def test_build_alert_email_html_shows_images_and_posts_together():
    from workers.alerts.email import build_alert_email_html

    subject, html = build_alert_email_html(
        alert_name="Nike",
        posts=[
            {
                "platform": "twitter",
                "channel_handle": "nike",
                "sentiment": "negative",
                "posted_at": "2026-06-15",
                "content": "a matched post body",
                "post_url": "https://x.com/1",
            }
        ],
        total_matched=3,
        max_items=10,
        images=[{"title": "Sentiment", "image_url": "https://m/x.png"}],
        app_url="https://app",
        agent_id="a1",
    )
    assert "3 new posts" in subject
    assert 'src="https://m/x.png"' in html  # widget image
    assert "a matched post body" in html  # AND the post feed below it
    assert "View live dashboard" in html
    assert "Manage this alert" in html


def test_build_alert_email_html_renders_post_cards_without_widgets():
    from workers.alerts.email import build_alert_email_html

    posts = [
        {
            "platform": "twitter",
            "channel_handle": "nike",
            "sentiment": "negative",
            "posted_at": "2026-06-15",
            "content": "shoulder gate returns",
            "post_url": "https://x.com/1",
            "media_refs": [{"media_type": "image", "original_url": "https://cdn/x.jpg"}],
        }
    ]
    subject, html = build_alert_email_html(
        alert_name="Nike",
        posts=posts,
        total_matched=1,
        max_items=10,
        images=None,
        app_url="https://app",
        agent_id="a1",
    )
    assert "1 new post matched" in subject
    assert "https://cdn/x.jpg" in html  # thumbnail from media_refs
    assert "Negative" in html  # sentiment badge
    assert "View post" in html
    assert 'src="https://m' not in html  # no widget image when images=None
    assert "Manage this alert" in html


def test_evaluator_uses_visual_email_when_widgets_render(monkeypatch):
    import workers.alerts.render_client as rc
    import workers.notifications.service as svc
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    html_sent: list[dict] = []
    monkeypatch.setattr(
        svc,
        "send_composed_html_email",
        lambda **k: (html_sent.append(k), {"status": "success", "message": "ok"})[1],
    )
    # Pretend the render service produced one image (bypass Chromium + GCS).
    monkeypatch.setattr(
        rc,
        "render_alert_widgets",
        lambda alert_id, widgets, **k: [{"title": "Sentiment", "image_url": "https://m/x.png"}],
    )

    fake = _eval_fs()
    fake.alerts["al1"]["widgets"] = [_widget("w1")]
    bq = FakeBQ([_post("p1", "negative")])

    summary = evaluate_alerts_for_collection("c1", bq=bq, fs=fake)
    assert summary["alerts_triggered"] == 1
    assert len(html_sent) == 1
    body = html_sent[0]["body_html"]
    assert "https://m/x.png" in body  # widget image
    assert "View post" in body  # AND the post feed
    assert fake.seen["al1"] == {"p1"}


def test_evaluator_falls_back_to_text_when_render_yields_nothing(captured_emails, monkeypatch):
    import workers.alerts.render_client as rc
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    # Widgets configured, but the render service returns nothing (unconfigured /
    # failed) → the email must still go out as text.
    monkeypatch.setattr(rc, "render_alert_widgets", lambda *a, **k: [])

    fake = _eval_fs()
    fake.alerts["al1"]["widgets"] = [_widget("w1")]
    bq = FakeBQ([_post("p1", "negative")])

    summary = evaluate_alerts_for_collection("c1", bq=bq, fs=fake)
    assert summary["alerts_triggered"] == 1
    assert len(captured_emails) == 1  # text path used


def test_evaluator_no_match_no_email(captured_emails):
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    fake = _eval_fs()
    bq = FakeBQ([_post("p1", "positive"), _post("p2", "neutral")])

    summary = evaluate_alerts_for_collection("c1", bq=bq, fs=fake)
    assert summary["alerts_triggered"] == 0
    assert captured_emails == []


def test_evaluator_skips_collection_without_agent(captured_emails):
    from workers.alerts.evaluator import evaluate_alerts_for_collection

    fake = FakeFS()
    fake.collections["orphan"] = {"user_id": "owner"}
    summary = evaluate_alerts_for_collection("orphan", bq=FakeBQ([]), fs=fake)
    assert summary["alerts_evaluated"] == 0
    assert captured_emails == []
