from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ArtifactListItem(BaseModel):
    artifact_id: str
    type: str
    title: str
    user_id: str
    org_id: str | None = None
    session_id: str
    collection_ids: list[str] = []
    favorited: bool = False
    shared: bool = False
    created_at: str
    updated_at: str
    chart_type: str | None = None


class ArtifactDetailResponse(ArtifactListItem):
    payload: dict[str, Any]


class UpdateArtifactRequest(BaseModel):
    title: str | None = None
    favorited: bool | None = None
    shared: bool | None = None
