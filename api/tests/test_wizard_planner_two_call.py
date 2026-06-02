"""Regression: wizard planner must issue two Gemini calls when search grounding
is enabled - one search-grounded research call, then one schema-strict synthesis
call with no tools.

Background: response_schema (controlled generation) is incompatible with the
google_search tool. Earlier code attached both to a single call, which either
silently dropped the search or produced empty fields in the structured output.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.agent.interpreters import wizard_planner


class _FakeClient:
    def __init__(self, responses: list):
        self._responses = list(responses)
        self.calls: list[dict] = []
        self.models = self  # client.models.generate_content → self.generate_content

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self._responses.pop(0)


@pytest.fixture()
def stub_cost_meter(monkeypatch):
    monkeypatch.setattr(
        "api.services.cost_meter.log_gemini_response",
        lambda *a, **kw: None,
    )


def _plan_json() -> str:
    return (
        '{"status":"plan","plan":{'
        '"title":"Spotify logo reactions",'
        '"summary":"Track reactions to the Spotify logo change across TikTok, IG, X.",'
        '"reasoning":"User asked for a recurring monitor on a recent brand event.",'
        '"existing_collection_ids":[],'
        '"task_type":"recurring",'
        '"schedule":{"frequency":"daily","time":"09:00"},'
        '"new_collection":{"platforms":["tiktok","instagram","twitter"],'
        '"keywords":["spotify logo"],"channel_urls":[],"time_range_days":30,'
        '"geo_scope":"global","n_posts":500},'
        '"outputs":[],"auto_report":true,"auto_email":false,"auto_slides":false,'
        '"custom_fields":[],'
        '"enrichment_context":"Posts reacting to Spotify\'s 2026 logo refresh.",'
        '"content_types":["review","meme","news","opinion","other"],'
        '"constitution":{}'
        "}}"
    )


def test_two_calls_when_grounding_enabled(monkeypatch, stub_cost_meter):
    fake = _FakeClient([
        SimpleNamespace(text="Spotify refreshed its logo in early 2026; reaction split."),
        SimpleNamespace(text=_plan_json()),
    ])
    monkeypatch.setattr(wizard_planner.genai, "Client", lambda **kw: fake)
    monkeypatch.setattr(
        wizard_planner, "get_settings",
        lambda: SimpleNamespace(
            gcp_project_id="p", gemini_location="us-central1",
            meta_agent_model="m", enable_search_grounding=True,
        ),
    )

    result = wizard_planner.plan_wizard(
        description="track reaction to spotify logo change in tiktok instagram and x",
        user_context={"collections": [], "now": "2026-05-19T12:00:00Z"},
    )

    assert result.status == "plan"
    assert len(fake.calls) == 2, "expected 2 Gemini calls (research + synthesis)"

    # Call 1: research - search tool attached, NO response_schema.
    c1 = fake.calls[0]["config"]
    assert c1.tools and any(t.google_search is not None for t in c1.tools), \
        "research call must include google_search tool"
    assert c1.response_schema is None, "research call must NOT use response_schema"

    # Call 2: synthesis - schema attached, NO tools.
    c2 = fake.calls[1]["config"]
    assert c2.response_schema is not None, "synthesis call must use response_schema"
    assert not c2.tools, "synthesis call must NOT pass tools alongside schema"

    # Research text must be injected into the synthesis prompt.
    assert "Spotify refreshed its logo" in fake.calls[1]["contents"]


def test_one_call_when_grounding_disabled(monkeypatch, stub_cost_meter):
    fake = _FakeClient([SimpleNamespace(text=_plan_json())])
    monkeypatch.setattr(wizard_planner.genai, "Client", lambda **kw: fake)
    monkeypatch.setattr(
        wizard_planner, "get_settings",
        lambda: SimpleNamespace(
            gcp_project_id="p", gemini_location="us-central1",
            meta_agent_model="m", enable_search_grounding=False,
        ),
    )

    result = wizard_planner.plan_wizard(
        description="track reaction to spotify logo change",
        user_context={"collections": [], "now": "2026-05-19T12:00:00Z"},
    )

    assert result.status == "plan"
    assert len(fake.calls) == 1, "grounding off → single synthesis call only"
    assert fake.calls[0]["config"].response_schema is not None
    assert not fake.calls[0]["config"].tools


def test_research_failure_falls_back_to_single_call(monkeypatch, stub_cost_meter, caplog):
    """If the research call raises, planner logs a warning and proceeds with
    an un-grounded synthesis call (one call total, no exception)."""

    class _ExplodingClient(_FakeClient):
        def generate_content(self, *, model, contents, config):
            self.calls.append({"model": model, "contents": contents, "config": config})
            if config.tools:  # research call
                raise RuntimeError("vertex unavailable")
            return self._responses.pop(0)

    fake = _ExplodingClient([SimpleNamespace(text=_plan_json())])
    monkeypatch.setattr(wizard_planner.genai, "Client", lambda **kw: fake)
    monkeypatch.setattr(
        wizard_planner, "get_settings",
        lambda: SimpleNamespace(
            gcp_project_id="p", gemini_location="us-central1",
            meta_agent_model="m", enable_search_grounding=True,
        ),
    )

    result = wizard_planner.plan_wizard(
        description="track reaction to spotify logo change",
        user_context={"collections": [], "now": "2026-05-19T12:00:00Z"},
    )

    assert result.status == "plan"
    # 1 research attempt (failed) + 1 synthesis call = 2 invocations recorded,
    # but only the synthesis one returned. The synthesis call must not include
    # research text.
    synthesis_calls = [c for c in fake.calls if not c["config"].tools]
    assert len(synthesis_calls) == 1
    assert "Background research" not in synthesis_calls[0]["contents"] \
        or "gathered via web search" not in synthesis_calls[0]["contents"]


def test_no_research_when_answering_clarifications(monkeypatch, stub_cost_meter):
    """Once user has answered prior clarification questions, the research step
    is skipped - we already know enough to plan, and a second turn shouldn't
    repeat the search."""
    fake = _FakeClient([SimpleNamespace(text=_plan_json())])
    monkeypatch.setattr(wizard_planner.genai, "Client", lambda **kw: fake)
    monkeypatch.setattr(
        wizard_planner, "get_settings",
        lambda: SimpleNamespace(
            gcp_project_id="p", gemini_location="us-central1",
            meta_agent_model="m", enable_search_grounding=True,
        ),
    )

    result = wizard_planner.plan_wizard(
        description="track reaction to spotify logo change",
        user_context={"collections": [], "now": "2026-05-19T12:00:00Z"},
        prior_answers={"angle": ["brand perception"]},
    )

    assert result.status == "plan"
    assert len(fake.calls) == 1, "clarification follow-up must not re-run research"
