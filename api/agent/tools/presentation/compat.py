"""Backward compatibility — convert old slide specs to new DeckPlan format.

The old format used 'type' per slide (e.g., "chart_pie", "kpi_grid").
This module translates to the new layout + component structure.
"""


def _text(t: str, style: str = "body") -> dict:
    return {"component": "text", "text": t, "style": style}


def _bullets(items: list) -> dict:
    return {"component": "text", "bullets": items, "style": "body"}


def _chart(chart_type: str, spec: dict) -> dict:
    return {
        "component": "chart",
        "chart_type": chart_type,
        "labels": [str(l) for l in spec.get("labels", spec.get("dates", []))],
        "values": spec.get("values", []),
        "series_name": spec.get("series_name", ""),
    }


def _table(spec: dict) -> dict:
    return {
        "component": "table",
        "columns": spec.get("columns", []),
        "rows": spec.get("rows", []),
    }


def _kpi(spec: dict) -> dict:
    return {
        "component": "kpi_grid",
        "items": spec.get("items", []),
    }


def _finding(spec: dict) -> dict:
    return {
        "component": "key_finding",
        "finding": spec.get("finding", ""),
        "significance": spec.get("significance", "notable"),
    }


def _convert_slide(old_spec: dict) -> dict:
    """Convert a single old-format slide spec to new format."""
    slide_type = old_spec.get("type", "")
    title = old_spec.get("title", "")

    converters = {
        "title_slide": lambda s: {
            "layout": "Title Slide",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "subtitle": _text(s.get("subtitle", ""), "subtitle"),
            },
        },
        "section": lambda s: {
            "layout": "Section Header",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _text(s.get("subtitle", ""), "body"),
            },
        },
        "bullets": lambda s: {
            "layout": "Title and Content",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _bullets(s.get("bullets", [])),
            },
        },
        "chart_bar": lambda s: {
            "layout": "Title and Content",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _chart("bar", s),
            },
        },
        "chart_pie": lambda s: {
            "layout": "Title and Content",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _chart("pie", s),
            },
        },
        "chart_line": lambda s: {
            "layout": "Title and Content",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _chart("line", s),
            },
        },
        "chart_row": lambda s: _convert_chart_row(s),
        "table": lambda s: {
            "layout": "Title and Content",
            "content": {
                "title": _text(s.get("title", ""), "heading"),
                "body": _table(s),
            },
        },
        "kpi_grid": lambda s: {
            "layout": "Title Only",
            "content": {
                "title": _text(s.get("title", "Key Metrics"), "heading"),
                "custom": _kpi(s),
            },
        },
        "key_finding": lambda s: {
            "layout": "Title Only",
            "content": {
                "title": _text(s.get("title", "Key Finding"), "heading"),
                "custom": _finding(s),
            },
        },
        "closing": lambda s: {
            "layout": "Title Slide",
            "content": {
                "title": _text(s.get("title", "Thank you"), "heading"),
                "subtitle": _text(s.get("message", ""), "subtitle"),
            },
        },
    }

    converter = converters.get(slide_type)
    if converter:
        return converter(old_spec)

    # Unknown type — try to render as bullets
    return {
        "layout": "Title and Content",
        "content": {
            "title": _text(title, "heading"),
            "body": _text(str(old_spec), "body"),
        },
    }


def _convert_chart_row(spec: dict) -> dict:
    """Convert the old chart_row (2 side-by-side charts) to Two Content layout."""
    charts = spec.get("charts", [])
    content: dict = {"title": _text(spec.get("title", ""), "heading")}

    if len(charts) >= 1:
        c0 = charts[0]
        ct = c0.get("type", "bar").replace("chart_", "")
        content["left"] = _chart(ct, c0)

    if len(charts) >= 2:
        c1 = charts[1]
        ct = c1.get("type", "bar").replace("chart_", "")
        content["right"] = _chart(ct, c1)

    return {"layout": "Two Content", "content": content}


def convert_legacy_slides(
    slides: list[dict],
    title: str = "",
    collection_ids: list[str] = None,
    template_gcs_path: str = "",
) -> dict:
    """Convert a list of old-format slide specs to a DeckPlan dict."""
    return {
        "title": title or "Presentation",
        "collection_ids": collection_ids or [],
        "template_gcs_path": template_gcs_path,
        "slides": [_convert_slide(s) for s in slides],
    }
