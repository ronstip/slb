"""Regression test for SSE-stream error capture (api/routers/chat.py).

Agent-stream crashes are swallowed by the `/chat` generator's `except` block -
it degrades them to a `stream_error` SSE event so the client gets a clean
message. That means the exception never reaches the global handler / ASGI
layer, so the ONLY path to Sentry is the explicit `capture_stream_error` call.
This test pins that contract: the exception is captured, tagged with the
request/session correlation ids, and the chat context (user/org/agent) is
attached. Without the capture, agent failures (e.g. the deck-plan validation
blowup) vanish from Sentry entirely.
"""

from __future__ import annotations

from contextlib import contextmanager

from api.routers import chat as chat_module


class _FakeScope:
    def __init__(self) -> None:
        self.tags: dict[str, str] = {}
        self.contexts: dict[str, dict] = {}

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value

    def set_context(self, key: str, value: dict) -> None:
        self.contexts[key] = value


class _FakeSentry:
    def __init__(self) -> None:
        self.scope = _FakeScope()
        self.captured: list[BaseException] = []

    @contextmanager
    def new_scope(self):
        yield self.scope

    def capture_exception(self, exc: BaseException) -> None:
        self.captured.append(exc)


def test_capture_stream_error_sends_to_sentry_with_correlation(monkeypatch) -> None:
    fake = _FakeSentry()
    monkeypatch.setattr(chat_module, "sentry_sdk", fake)

    boom = RuntimeError("Invalid deck plan: 7 validation errors for DeckPlan")
    chat_module.capture_stream_error(
        boom,
        request_id="rid-123",
        session_id="sess-abc",
        user_id="user-1",
        org_id="org-9",
        agent_id="agent-7",
    )

    # The swallowed exception must reach Sentry...
    assert fake.captured == [boom]
    # ...tagged so the issue lines up with Cloud Logging + the client response.
    assert fake.scope.tags["request_id"] == "rid-123"
    assert fake.scope.tags["session_id"] == "sess-abc"
    assert fake.scope.tags["service"] == "api"
    assert fake.scope.contexts["chat"] == {
        "user_id": "user-1",
        "org_id": "org-9",
        "agent_id": "agent-7",
    }


def test_capture_stream_error_tolerates_missing_context(monkeypatch) -> None:
    # Anonymous / pre-agent failures have no user/org/agent - capture must still
    # fire (the crash is the whole point) rather than blow up on None.
    fake = _FakeSentry()
    monkeypatch.setattr(chat_module, "sentry_sdk", fake)

    boom = ValueError("stream blew up before an agent was selected")
    chat_module.capture_stream_error(boom, request_id="unknown", session_id="sess-x")

    assert fake.captured == [boom]
    assert fake.scope.contexts["chat"] == {
        "user_id": None,
        "org_id": None,
        "agent_id": None,
    }
