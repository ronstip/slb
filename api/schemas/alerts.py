"""Request/response schemas for dynamic per-agent email alerts.

An alert is a saved filter (the dashboard `SocialWidgetFilters` object, reused
verbatim) attached to an agent. The filter shape, operators, and fields are the
exact ones the dashboard widget config uses - so the same FilterForm UI, the
same Python evaluation engine (`dashboard_widget_filters.apply_widget_filters`),
and the same agent-emitted JSON all carry over with zero new vocabulary.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.routers.dashboard_schema import SocialDashboardWidget, SocialWidgetFilters

MAX_RECIPIENTS = 20
MIN_ITEMS_PER_EMAIL = 1
MAX_ITEMS_PER_EMAIL = 50
DEFAULT_ITEMS_PER_EMAIL = 10
# How many dashboard widgets one alert email may render. Kept small so an email
# stays scannable and the per-send headless render cost stays bounded.
MAX_WIDGETS_PER_ALERT = 4

# Pragmatic email shape check - not RFC-complete, just enough to reject typos
# and obvious garbage before we hand the address to SendGrid.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_recipients(recipients: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in recipients:
        addr = (raw or "").strip()
        if not addr:
            continue
        if not _EMAIL_RE.match(addr):
            raise ValueError(f"Invalid email address: {raw!r}")
        key = addr.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(addr)
    if len(cleaned) > MAX_RECIPIENTS:
        raise ValueError(f"At most {MAX_RECIPIENTS} recipients allowed per alert.")
    return cleaned


class AlertCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=120)
    filters: SocialWidgetFilters = Field(default_factory=SocialWidgetFilters)
    recipients: list[str] = Field(default_factory=list)
    enabled: bool = True
    max_items_per_email: int = Field(default=DEFAULT_ITEMS_PER_EMAIL)
    # Dashboard widgets rendered (as PNGs) into the alert email. Empty → the
    # legacy text/post-list body. Same schema as a dashboard widget so the
    # builder UI and renderer are reused verbatim.
    widgets: list[SocialDashboardWidget] = Field(
        default_factory=list, max_length=MAX_WIDGETS_PER_ALERT
    )

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Alert name is required.")
        return v

    @field_validator("recipients")
    @classmethod
    def _check_recipients(cls, v: list[str]) -> list[str]:
        return _validate_recipients(v)

    @field_validator("max_items_per_email")
    @classmethod
    def _clamp_items(cls, v: int) -> int:
        return max(MIN_ITEMS_PER_EMAIL, min(MAX_ITEMS_PER_EMAIL, v))


class AlertUpdate(BaseModel):
    """Partial update - every field optional; only provided keys are written."""

    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, max_length=120)
    filters: SocialWidgetFilters | None = None
    recipients: list[str] | None = None
    enabled: bool | None = None
    max_items_per_email: int | None = None
    # None → leave widgets untouched; [] → clear (revert to text email).
    widgets: list[SocialDashboardWidget] | None = Field(
        default=None, max_length=MAX_WIDGETS_PER_ALERT
    )

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Alert name cannot be empty.")
        return v

    @field_validator("recipients")
    @classmethod
    def _check_recipients(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return _validate_recipients(v)

    @field_validator("max_items_per_email")
    @classmethod
    def _clamp_items(cls, v: int | None) -> int | None:
        if v is None:
            return None
        return max(MIN_ITEMS_PER_EMAIL, min(MAX_ITEMS_PER_EMAIL, v))


class AlertPreviewRequest(BaseModel):
    """Dry-run: 'which of this agent's recent posts would this filter match?'"""

    model_config = ConfigDict(extra="ignore")

    filters: SocialWidgetFilters = Field(default_factory=SocialWidgetFilters)
