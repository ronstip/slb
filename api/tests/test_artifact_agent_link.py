"""Artifacts must store their owning `agent_id` so dashboard layouts (keyed by
artifact_id) can resolve back to the agent for shared-component access checks.
"""

from __future__ import annotations

from api.services import artifact_service


class _FakeFS:
    def __init__(self):
        self.created: dict | None = None

    def create_artifact(self, artifact_id, data):
        self.created = data

    def add_agent_artifact(self, agent_id, artifact_id):
        pass


def test_created_artifact_stores_agent_id(monkeypatch):
    fake = _FakeFS()
    monkeypatch.setattr(artifact_service, "get_fs", lambda: fake)

    artifact_service.persist_tool_result_artifact(
        tool_name="create_markdown",
        result={"status": "success", "content": "hi", "title": "T"},
        user_id="owner",
        org_id="orgA",
        session_id="s1",
        agent_id="agent-123",
    )

    assert fake.created is not None
    assert fake.created["agent_id"] == "agent-123"
    assert fake.created["shared"] is False
