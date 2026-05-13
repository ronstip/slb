"""Build the v4 weekly competitive brand report template.

Changes from v3:
  - Per-widget heights tuned from observed v3-demo content sizes (no more
    400–800 px of empty space below every section).
  - Section briefs gain an explicit "Hierarchy" note: H2 once per widget for
    the main section header; H3 for actor sub-sections within §6 and §11; no
    use of H2 inside the body. The CSS now styles H2 with a bottom-border
    for stronger visual hierarchy.
  - Inline-code wrapping rule loosened: long identifiers no longer break mid-
    word (handled in the CSS, but worth flagging because briefs use code
    spans for column / field names).
  - Tone block tightened to remove redundant phrasing.

Chart widgets unchanged.

Usage:
    uv run python scripts/build_dashboard_template_v4.py [--dry-run]
"""

import argparse
import os
import sys
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

# Re-use briefs from v3 (just import them) — only heights and a few notes
# differ in v4. Easier to maintain.
from scripts.build_dashboard_template_v3 import (  # noqa: E402
    HEADER_MD, SEC_2_MD, SEC_3_MD, SEC_4_MD, SEC_5_MD, SEC_6_MD, SEC_7_MD,
    SEC_8A_MD, SEC_8B_MD, SEC_8C_MD, SEC_8D_MD, SEC_9_MD, SEC_10_MD,
    SEC_11_MD, SEC_12_MD, SEC_13_MD, SEC_14_INTRO_MD, SEC_14_X_MD_TEMPLATE,
    APPENDIX_MD, _chart_widgets,
)
from api.deps import get_fs  # noqa: E402

V4_TEMPLATE_ID = "b4f7a2c1d8e5b6f3a9c0b1d2e3f4a5b6"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Layout assembly ────────────────────────────────────────────────────────


def _text(i: str, md: str, h: int, w: int = 12) -> dict:
    return {
        "i": i,
        "chartType": "table",
        "aggregation": "text",
        "w": w,
        "h": h,
        "title": "Text",
        "markdownContent": md,
    }


# Heights tuned from measured v3 content + 1–2 row buffer for content variance.
HEIGHTS = {
    "v4hdr0000a": 3,
    "v4sec02met": 10,
    "v4sec03toc": 13,
    "v4sec04exe": 14,
    "v4sec05sov": 15,
    "v4sec06pos": 20,
    "v4sec07chr": 20,
    "v4sec08a00": 18,
    "v4sec08b00": 9,
    "v4sec08c00": 10,
    "v4sec08d00": 7,
    "v4sec09nar": 13,
    "v4sec10plt": 8,
    "v4sec11chn": 13,
    "v4sec12aud": 10,
    "v4sec13rsk": 10,
    "v4sec14int": 4,
    "v4sec14r01": 12,
    "v4sec14r02": 10,
    "v4sec14r03": 10,
    "v4sec14r04": 10,
    "v4secapp00": 26,
}


def build_layout() -> list[dict]:
    charts = {w["i"]: w for w in _chart_widgets()}

    seq: list[dict] = [
        _text("v4hdr0000a", HEADER_MD, h=HEIGHTS["v4hdr0000a"]),
        _text("v4sec02met", SEC_2_MD, h=HEIGHTS["v4sec02met"]),
        _text("v4sec03toc", SEC_3_MD, h=HEIGHTS["v4sec03toc"]),
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        _text("v4sec04exe", SEC_4_MD, h=HEIGHTS["v4sec04exe"]),
        _text("v4sec05sov", SEC_5_MD, h=HEIGHTS["v4sec05sov"]),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("v4sec06pos", SEC_6_MD, h=HEIGHTS["v4sec06pos"]),
        _text("v4sec07chr", SEC_7_MD, h=HEIGHTS["v4sec07chr"]),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("v4sec08a00", SEC_8A_MD, h=HEIGHTS["v4sec08a00"]),
        _text("v4sec08b00", SEC_8B_MD, h=HEIGHTS["v4sec08b00"]),
        _text("v4sec08c00", SEC_8C_MD, h=HEIGHTS["v4sec08c00"]),
        _text("v4sec08d00", SEC_8D_MD, h=HEIGHTS["v4sec08d00"]),
        _text("v4sec09nar", SEC_9_MD, h=HEIGHTS["v4sec09nar"]),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("v4sec10plt", SEC_10_MD, h=HEIGHTS["v4sec10plt"]),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        _text("v4sec11chn", SEC_11_MD, h=HEIGHTS["v4sec11chn"]),
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("v4sec12aud", SEC_12_MD, h=HEIGHTS["v4sec12aud"]),
        _text("v4sec13rsk", SEC_13_MD, h=HEIGHTS["v4sec13rsk"]),
        _text("v4sec14int", SEC_14_INTRO_MD, h=HEIGHTS["v4sec14int"]),
        _text("v4sec14r01", SEC_14_X_MD_TEMPLATE.format(n=1), h=HEIGHTS["v4sec14r01"]),
        _text("v4sec14r02", SEC_14_X_MD_TEMPLATE.format(n=2), h=HEIGHTS["v4sec14r02"]),
        _text("v4sec14r03", SEC_14_X_MD_TEMPLATE.format(n=3), h=HEIGHTS["v4sec14r03"]),
        _text("v4sec14r04", SEC_14_X_MD_TEMPLATE.format(n=4), h=HEIGHTS["v4sec14r04"]),
        _text("v4sec14r05", SEC_14_X_MD_TEMPLATE.format(n=5), h=HEIGHTS.get("v4sec14r05", 10)),
        _text("v4secapp00", APPENDIX_MD, h=HEIGHTS["v4secapp00"]),
    ]

    out: list[dict] = []
    y = 0
    i = 0
    while i < len(seq):
        w = seq[i]
        if w.get("aggregation") == "sentiment" and i + 1 < len(seq) \
                and seq[i + 1].get("aggregation") == "platform":
            row_h = max(w["h"], seq[i + 1]["h"])
            a = {**{k: v for k, v in w.items() if not k.startswith("x_")},
                 "x": 1, "y": y, "h": row_h}
            b = {**{k: v for k, v in seq[i + 1].items() if not k.startswith("x_")},
                 "x": 6, "y": y, "h": row_h}
            out.append(a)
            out.append(b)
            y += row_h
            i += 2
            continue
        if w.pop("x_inset", False):
            w = {**w, "x": 1, "y": y}
            out.append(w)
            y += w["h"]
            i += 1
            continue
        if w.get("aggregation") == "kpi" and i + 3 < len(seq) \
                and all(seq[i + j].get("aggregation") == "kpi" for j in range(4)):
            for k, off in enumerate([0, 3, 6, 9]):
                kw = {**seq[i + k], "x": off, "y": y, "w": 3, "h": 2}
                out.append(kw)
            y += 2
            i += 4
            continue
        w_ = {**w, "x": 0, "y": y, "w": w.get("w", 12)}
        out.append(w_)
        y += w_["h"]
        i += 1
    return out


def write_template(dry_run: bool) -> None:
    layout = build_layout()
    title = "Weekly Competitive Brand Report (Template v4)"

    print(f"v4 layout: {len(layout)} widgets")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("DRY RUN — not writing.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(V4_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V4_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    now_iso = "2026-05-13T16:00:00+00:00"
    db.collection("explorer_layouts").document(V4_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v4 template: dashboard_layouts/{V4_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
