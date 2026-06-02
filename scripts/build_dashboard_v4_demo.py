"""Build v4 DEMO dashboard - v3 demo content + tuned heights from v3 measurements."""

import argparse
import copy
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

# Re-use v3 demo content.
from scripts.build_dashboard_v3_demo import (  # noqa: E402
    HDR, SEC_2, SEC_3, SEC_4, SEC_5, SEC_6, SEC_7,
    SEC_8A, SEC_8B, SEC_8C, SEC_8D, SEC_9, SEC_10, SEC_11, SEC_12, SEC_13,
    SEC_14_INTRO, SEC_14_1, SEC_14_2, SEC_14_3, SEC_14_4, APP,
    CHART_TITLE_OVERRIDES, CHART_FIGURE_OVERRIDES,
)
from scripts.build_dashboard_template_v4 import V4_TEMPLATE_ID  # noqa: E402
from api.deps import get_fs  # noqa: E402

V4_DEMO_ID = "e4f1c2d3a4b5d6e7f8a9b0c1d2e3f4a5"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# Map v4 template widget IDs → demo content (same content as v3 demo, new IDs).
CONTENT_BY_I = {
    "v4hdr0000a": HDR,
    "v4sec02met": SEC_2,
    "v4sec03toc": SEC_3,
    "v4sec04exe": SEC_4,
    "v4sec05sov": SEC_5,
    "v4sec06pos": SEC_6,
    "v4sec07chr": SEC_7,
    "v4sec08a00": SEC_8A,
    "v4sec08b00": SEC_8B,
    "v4sec08c00": SEC_8C,
    "v4sec08d00": SEC_8D,
    "v4sec09nar": SEC_9,
    "v4sec10plt": SEC_10,
    "v4sec11chn": SEC_11,
    "v4sec12aud": SEC_12,
    "v4sec13rsk": SEC_13,
    "v4sec14int": SEC_14_INTRO,
    "v4sec14r01": SEC_14_1,
    "v4sec14r02": SEC_14_2,
    "v4sec14r03": SEC_14_3,
    "v4sec14r04": SEC_14_4,
    "v4secapp00": APP,
}

WIDGETS_TO_REMOVE = {"v4sec14r05"}


def fetch_template_layout(db) -> list[dict]:
    snap = db.collection("dashboard_layouts").document(V4_TEMPLATE_ID).get()
    if not snap.exists:
        raise SystemExit(f"v4 template not found at dashboard_layouts/{V4_TEMPLATE_ID}")
    return copy.deepcopy(snap.to_dict().get("layout") or [])


def fill_layout(layout: list[dict]) -> list[dict]:
    out: list[dict] = []
    y = 0
    for w in layout:
        i = w.get("i")
        if i in WIDGETS_TO_REMOVE:
            continue
        ww = copy.deepcopy(w)
        ww["y"] = y
        if ww.get("aggregation") == "text" and i in CONTENT_BY_I:
            ww["markdownContent"] = CONTENT_BY_I[i]
        if ww.get("aggregation") != "text":
            if i in CHART_TITLE_OVERRIDES:
                ww["title"] = CHART_TITLE_OVERRIDES[i]
            if i in CHART_FIGURE_OVERRIDES and "figureText" in ww:
                ww["figureText"] = CHART_FIGURE_OVERRIDES[i]
        out.append(ww)
        row_widgets = [x for x in out if x["y"] == y]
        if all(x["x"] + x["w"] >= 12 for x in row_widgets) or \
                row_widgets[-1]["x"] + row_widgets[-1]["w"] >= 12:
            y = max(x["y"] + x["h"] for x in row_widgets)
    return out


def write_demo(dry_run: bool) -> None:
    fs = get_fs()
    db = fs._db
    template_layout = fetch_template_layout(db)
    filled = fill_layout(template_layout)

    title = "דוח תחרותי שבועי v4 (Demo) - קמפיין נפתלי בנט (2026-05-06 → 2026-05-12)"
    print(f"v4 demo: {len(filled)} widgets")
    print(f"  max y: {max(w['y'] + w['h'] for w in filled)}")

    if dry_run:
        print("DRY RUN - not writing.")
        return

    db.collection("dashboard_layouts").document(V4_DEMO_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V4_DEMO_ID,
        "layout": filled,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": False,
        "source_template_id": V4_TEMPLATE_ID,
    })

    now_iso = "2026-05-13T16:30:00+00:00"
    db.collection("explorer_layouts").document(V4_DEMO_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v4 demo: dashboard_layouts/{V4_DEMO_ID}")
    print(f"View: http://localhost:5174/agents/{AGENT_ID_FOR_EXPLORER}?tab=explorer&layout={V4_DEMO_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_demo(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
