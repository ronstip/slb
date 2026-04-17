"""Pydantic models for the deck plan and component specifications.

These models validate the agent's output before rendering.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator


# ── Component specs ──────────────────────────────────────────────────────────

class TextComponent(BaseModel):
    component: Literal["text"] = "text"
    text: str = ""
    bullets: list[str] = Field(default_factory=list)
    style: Literal["heading", "body", "subtitle"] = "body"

    @model_validator(mode="after")
    def _require_content(self) -> "TextComponent":
        if not self.text and not self.bullets:
            raise ValueError("TextComponent must have 'text' or 'bullets'")
        return self


class ChartComponent(BaseModel):
    component: Literal["chart"] = "chart"
    chart_type: Literal["bar", "pie", "line"] = "bar"
    labels: list[str] = Field(default_factory=list)
    values: list[float] = Field(default_factory=list)
    series_name: str = ""

    @model_validator(mode="after")
    def _validate_data(self) -> "ChartComponent":
        if len(self.labels) != len(self.values):
            raise ValueError(
                f"Chart labels ({len(self.labels)}) and values ({len(self.values)}) must have equal length"
            )
        if not self.labels:
            raise ValueError("Chart must have at least one data point")
        return self


class TableComponent(BaseModel):
    component: Literal["table"] = "table"
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_shape(self) -> "TableComponent":
        if not self.columns:
            raise ValueError("Table must have at least one column")
        for i, row in enumerate(self.rows):
            if len(row) != len(self.columns):
                raise ValueError(
                    f"Row {i} has {len(row)} values but table has {len(self.columns)} columns"
                )
        return self


class KpiGridComponent(BaseModel):
    component: Literal["kpi_grid"] = "kpi_grid"
    items: list[dict[str, str]] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_items(self) -> "KpiGridComponent":
        if not self.items:
            raise ValueError("KPI grid must have at least one item")
        if len(self.items) > 8:
            raise ValueError(f"KPI grid supports up to 8 items, got {len(self.items)}")
        for i, item in enumerate(self.items):
            if "label" not in item or "value" not in item:
                raise ValueError(f"KPI item {i} must have 'label' and 'value'")
        return self


class KeyFindingComponent(BaseModel):
    component: Literal["key_finding"] = "key_finding"
    finding: str
    significance: Literal["surprising", "notable"] = "notable"


# Union of all component types
ComponentSpec = Union[
    TextComponent,
    ChartComponent,
    TableComponent,
    KpiGridComponent,
    KeyFindingComponent,
]


def parse_component(raw: dict) -> ComponentSpec:
    """Parse a raw dict into the appropriate component model."""
    comp_type = raw.get("component", "")
    mapping = {
        "text": TextComponent,
        "chart": ChartComponent,
        "table": TableComponent,
        "kpi_grid": KpiGridComponent,
        "key_finding": KeyFindingComponent,
    }
    cls = mapping.get(comp_type)
    if cls is None:
        raise ValueError(f"Unknown component type: {comp_type!r}")
    return cls.model_validate(raw)


# ── Slide spec ───────────────────────────────────────────────────────────────

class SlideSpec(BaseModel):
    """A single slide in the deck plan."""
    layout: str  # layout name, e.g. "Title and Content"
    content: dict[str, dict] = Field(default_factory=dict)
    # content keys: "title", "subtitle", "body", "body_2", "left", "right", "custom"

    def validate_components(self) -> list[str]:
        """Validate all components in content, return list of errors."""
        errors = []
        for slot, raw in self.content.items():
            try:
                parse_component(raw)
            except (ValueError, Exception) as e:
                errors.append(f"slot '{slot}': {e}")
        return errors


# ── Deck plan ────────────────────────────────────────────────────────────────

class DeckPlan(BaseModel):
    """The complete deck plan produced by the agent."""
    title: str = "Presentation"
    collection_ids: list[str] = Field(default_factory=list)
    template_gcs_path: str = ""
    slides: list[SlideSpec] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_slides(self) -> "DeckPlan":
        if not self.slides:
            raise ValueError("Deck plan must have at least one slide")
        return self
