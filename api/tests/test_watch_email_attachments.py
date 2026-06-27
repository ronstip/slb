"""EmailNotifier picks the HTML (widget-image) path iff attachments are present,
and render_watch_widgets degrades to [] when the render feature is unconfigured."""

from __future__ import annotations

from types import SimpleNamespace

import workers.notifications.service as email_service
import workers.watches.render_client as render_client
from workers.watches.notifiers import EmailNotifier, NotificationPayload


class FakeFS:
    def get_user(self, uid):
        return {"email": "owner@x.com"}


def _payload(**over):
    base = dict(title="Watch fired", body_markdown="**hi**", owner_uid="u1", recipients=[])
    base.update(over)
    return NotificationPayload(**base)


def test_markdown_path_when_no_attachments(monkeypatch):
    calls = {"md": 0, "html": 0}
    monkeypatch.setattr(email_service, "send_composed_email",
                        lambda **k: (calls.__setitem__("md", calls["md"] + 1) or {"status": "success"}))
    monkeypatch.setattr(email_service, "send_composed_html_email",
                        lambda **k: (calls.__setitem__("html", calls["html"] + 1) or {"status": "success"}))

    res = EmailNotifier(FakeFS()).deliver(_payload())
    assert res.ok
    assert calls == {"md": 1, "html": 0}


def test_html_path_when_attachments_present(monkeypatch):
    calls = {"md": 0, "html": 0}
    monkeypatch.setattr(email_service, "send_composed_email",
                        lambda **k: (calls.__setitem__("md", calls["md"] + 1) or {"status": "success"}))
    monkeypatch.setattr(email_service, "send_composed_html_email",
                        lambda **k: (calls.__setitem__("html", calls["html"] + 1) or {"status": "success"}))
    monkeypatch.setattr("config.settings.get_settings",
                        lambda: SimpleNamespace(frontend_url="http://app.test"))

    images = [{"title": "Sentiment", "image_url": "http://m/x.png", "width": 1000, "height": 440}]
    res = EmailNotifier(FakeFS()).deliver(_payload(attachments=images, agent_id="ag1"))
    assert res.ok
    assert calls == {"md": 0, "html": 1}


def test_render_widgets_empty_when_unconfigured(monkeypatch):
    monkeypatch.setattr(render_client, "get_settings",
                        lambda: SimpleNamespace(render_service_url=None, alert_render_secret=None))
    out = render_client.render_watch_widgets(
        "u1", "w1", [{"title": "x"}], win_start_iso="s", win_end_iso="e"
    )
    assert out == []
