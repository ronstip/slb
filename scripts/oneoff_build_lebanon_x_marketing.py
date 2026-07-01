"""One-off: rewrite the tweet copy for the Israel-Lebanon "post suggestions" report.

The user curated the charts by hand (kept 5 widgets: per-language reaction_frame
doughnuts for AR/HE/EN by views, likes-by-language×stance, figures×stance by
likes). This script does NOT regenerate those charts — it READS the live layout,
preserves each chart widget verbatim (ids, customConfig, filters, metrics), and
only (a) repositions them into one chart-per-row and (b) replaces the text
widgets with new tweets.

Tweet format (per request): ONE post = a **catchy hook** + a single **opinion-
reading paragraph** synthesising public opinion over the ~20 hours from the
agreement's publication (signing ≈ 17:00 UTC 26 Jun → data to ~11:00 UTC 27 Jun),
with all kept charts arranged beneath it as the **carousel** (images to attach).
English body (publishable on X) under a Hebrew section header (render rule: text
widgets show only markdownContent, lead with `## `; h1 reserved for page title).

Run:  ENVIRONMENT=production uv run python scripts/oneoff_build_lebanon_x_marketing.py [--apply]
"""
import os, sys

_root = os.path.abspath(os.path.dirname(__file__) + "/..")
sys.path.insert(0, _root)
for _f in (".env",):
    p = os.path.join(_root, _f)
    if os.path.exists(p):
        for _l in open(p):
            _l = _l.strip()
            if _l and not _l.startswith("#") and "=" in _l:
                _k, _, _v = _l.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from datetime import datetime, timezone
from api.deps import get_fs
from api.routers.dashboard_schema import SocialDashboardWidget, ReportConfig, GRID_COLS

AGENT_ID = "028543a6-9f57-4e4f-84b1-7f58f110a46a"
USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
LAYOUT_ID = "7e1c4a90b2d04f6f9a3c5e21d8b6f4a0"
TITLE = "הסכם ישראל–לבנון: רעיונות לפוסטים ב-X (שיווק)"

# Chart widgets the user kept — referenced by id; configs preserved verbatim.
AR, HE, EN = "1f1uhp79c", "szagt0s21", "yufu46mt1"
M1, M4 = "m1_stance_lang", "m4_figs"

LX, LW = 0, 4   # chart (left)
RX, RW = 4, 8   # tweet (right)


def text(i, x, y, w, h, md):
    return {"i": i, "x": x, "y": y, "w": w, "h": h, "aggregation": "text",
            "chartType": "table", "title": i, "markdownContent": md, "manualHeight": True}


# ── The single post: HOOK + one 20h opinion-reading paragraph ────────────────
POST_MD = (
    "## 🐦 הפוסט (קרוסלה — כל הגרפים בציוץ אחד)\n\n"
    "**העתק-הדבק; אנגלית להגעה גלובלית. צרף את הגרפים למטה כתמונות (קרוסלה).**\n\n"
    "> We read **800+ posts** in Arabic, Hebrew & English in the **20 hours** after Israel & Lebanon "
    "signed. Same agreement — three completely different verdicts. 👇\n>\n"
    "> The split *is* the story. 🇱🇧 **Arabic** branded it *“the deal of shame”* — betrayal owned the "
    "reach (~351K views) and the tone only **hardened overnight**. 🇮🇱 **Hebrew** didn’t cry treason; "
    "it cried *naïve* — “**it won’t hold**” was the loudest frame, doubt over outrage. 🌐 **English** "
    "told a third story entirely: *“a **security win for Israel**”* drowned out everyone (~570K views).\n>\n"
    "> Then follow the **likes**: Arabic overwhelmingly rewards opposition (~10K), English is a dead "
    "heat, Hebrew quietly likes the skeptics. And the single most-liked take of the whole event? Not "
    "Lebanon — **criticism of Netanyahu** (~12K).\n>\n"
    "> One agreement, three audiences, one shared truth: **almost no one believes it will last.** 🧵\n\n"
    "*📊 קרוסלה: ערבית · עברית · אנגלית (מסגרות לפי צפיות) + לייקים-לפי-שפה + דמויות-לפי-לייקים. "
    "⚠️ X מאפשר עד 4 תמונות לציוץ — בחר 4, או אחד את 3 גרפי-השפה לתמונה אחת. קריאה על פני ~20 השעות "
    "מההכרזה (חתימה ~17:00 UTC, 26.6).*")


def build(existing_layout):
    """ONE post (hook + synthesis paragraph) + all kept charts as a carousel gallery.

    Charts preserved verbatim (ids/customConfig/filters) — only repositioned.
    """
    by_id = {w.get("i"): w for w in existing_layout}
    missing = [k for k in (AR, HE, EN, M1, M4) if k not in by_id]
    if missing:
        raise SystemExit(f"expected chart widgets missing from live layout: {missing}")

    def place(cid, x, y, w, h):
        c = dict(by_id[cid]); c.update({"x": x, "y": y, "w": w, "h": h}); return c

    out = []
    # Page title (h1)
    out.append(text("t_title", 0, 0, 12, 3,
        "# הסכם ישראל–לבנון: רעיון לפוסט ב-X\n\n"
        "**פוסט אחד (קרוסלה) — hook + פסקת ניתוח דעת-קהל על פני ~20 השעות מההכרזה, וכל הגרפים כתמונות.**"))
    # The single post text (full width)
    out.append(text("tw_post", 0, 3, 12, 7, POST_MD))
    # Carousel gallery — the images to attach. Row of 3 language doughnuts, then the two bars.
    out.append(place(AR, 0, 10, 4, 7))
    out.append(place(HE, 4, 10, 4, 7))
    out.append(place(EN, 8, 10, 4, 7))
    out.append(place(M1, 0, 17, 6, 8))
    out.append(place(M4, 6, 17, 6, 8))
    return out


def main() -> int:
    fs = get_fs()
    doc = fs._db.collection("dashboard_layouts").document(LAYOUT_ID).get().to_dict()
    if not doc:
        raise SystemExit("layout doc not found")
    layout = build(doc.get("layout", []))

    validated = []
    for w in layout:
        obj = SocialDashboardWidget(**w)
        if obj.x + obj.w > GRID_COLS:
            raise SystemExit(f"widget {w['i']}: x+w={obj.x+obj.w} > {GRID_COLS}")
        validated.append(obj)
    serialized = [o.model_dump(exclude_none=True, by_alias=True) for o in validated]

    miss_h = [w["i"] for w in layout if w["aggregation"] == "text"
              and not w["markdownContent"].lstrip().startswith("#")]
    nchart = sum(1 for w in layout if w["aggregation"] == "custom")
    print(f"✓ {len(validated)} widgets ({nchart} charts preserved, "
          f"{len(validated)-nchart} text); height={max(w['y']+w['h'] for w in layout)}")
    print(f"  text missing leading header: {miss_h or 'none'}")

    if "--apply" not in sys.argv:
        print("\nDRY RUN. Re-run with --apply.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    # Preserve reportConfig (colors), filterBar, etc — only swap layout + touch updated_at.
    fs._db.collection("dashboard_layouts").document(LAYOUT_ID).set(
        {"layout": serialized, "updated_at": now}, merge=True)
    fs._db.collection("explorer_layouts").document(LAYOUT_ID).set({"updated_at": now}, merge=True)
    back = fs._db.collection("dashboard_layouts").document(LAYOUT_ID).get().to_dict()
    assert len(back["layout"]) == len(validated)
    print(f"\n✓ APPLIED. layout_id={LAYOUT_ID} (charts preserved, tweets rewritten)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
