"""Watch render token: round-trip, tamper rejection, expiry — carries the firing
window so the headless render reads exactly the rows the detector fired on."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import workers.watches.render_token as rt
from workers.watches.render_token import RenderTokenError, mint_render_token, verify_render_token


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setattr(rt, "get_settings", lambda: SimpleNamespace(alert_render_secret="s3cr3t"))


def test_round_trip():
    tok = mint_render_token("u1", "w1", 2, win_start_iso="2026-06-01T00:00:00", win_end_iso="2026-06-08T00:00:00")
    uid, watch_id, idx, s, e = verify_render_token(tok)
    assert (uid, watch_id, idx, s, e) == ("u1", "w1", 2, "2026-06-01T00:00:00", "2026-06-08T00:00:00")


def test_tamper_rejected():
    tok = mint_render_token("u1", "w1", 0, win_start_iso=None, win_end_iso=None)
    body, _sig = tok.split(".", 1)
    forged = f"{body}.deadbeef"
    with pytest.raises(RenderTokenError):
        verify_render_token(forged)


def test_expired_rejected():
    tok = mint_render_token("u1", "w1", 0, win_start_iso=None, win_end_iso=None, ttl_seconds=-1)
    with pytest.raises(RenderTokenError):
        verify_render_token(tok)


def test_malformed_rejected():
    with pytest.raises(RenderTokenError):
        verify_render_token("not-a-token")
