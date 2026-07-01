"""Build/update the Israeli-hospitality demo Brief (Explorer tab) in PROD.

Demo narrative: this FB group is a DEMAND feed, not a review feed. Booking/TA/
Google only see post-stay reviews; this report shows the two things they can't —
who's shopping right now (posts) and the crowd's verdict (comments).

Two-metric funnel: Share of Consideration (posts, who's in the room) + Verdict
Net (comments, who wins the argument). Hero case study: King Solomon.

Edits the existing layout in place (same layout_id). All widget data flows
through the scope TVF (is_related_to_task IS TRUE) by design.

Usage: uv run python scripts/oneoff_build_hospitality_dashboard.py [--apply]
"""

import os, sys
from datetime import datetime, timezone
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))
for _l in open(_root / ".env"):
    _l = _l.strip()
    if _l and not _l.startswith("#") and "=" in _l:
        _k, _, _v = _l.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from api.deps import get_fs
from api.routers.dashboard_schema import SocialDashboardWidget, ReportConfig, GRID_COLS

AGENT_ID = "4fd42299-287c-429d-8915-946f88886adc"
USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
LAYOUT_ID = "6217712f40404d318ce6311a4cbe1c13"   # edit in place (existing Explorer layout)
TITLE = "Israeli Hotels — Demand & Verdict Intelligence"
WX, WW, SX, SW = 0, 8, 8, 4


def W(i, x, y, w, h, **kw): return {"i": i, "x": x, "y": y, "w": w, "h": h, **kw}
def text(i, x, y, w, h, title, md):
    return W(i, x, y, w, h, aggregation="text", chartType="table", title=title,
             markdownContent=md, manualHeight=True)
def custom(i, x, y, w, h, title, ct, cfg, src=None, desc=None):
    d = W(i, x, y, w, h, aggregation="custom", chartType=ct, title=title, customConfig=cfg)
    if src: d["dataSource"] = src
    if desc: d["description"] = desc
    return d
def builtin(i, x, y, w, h, agg, ct, title, src=None, desc=None):
    d = W(i, x, y, w, h, aggregation=agg, chartType=ct, title=title)
    if src: d["dataSource"] = src
    if desc: d["description"] = desc
    return d

ASK = "customobj:hotel_mentions.__count"

# ── WIDE COLUMN (x=0, w=8): the narrative + demand charts ───────────────────
wide = [
    text("w_thesis", WX, 0, WW, 5, "What Booking can't see",
         "> **This 109K-member group isn't a review site — it's a live demand feed. "
         "And the booking decision is being made here, before the money moves.**\n\n"
         "From **198 on-topic posts** and **1,012 crowd verdicts** (comments) in the Hebrew group "
         "*“מדברים על בתי מלון בישראל”*:\n\n"
         "- **84% of posts are people *shopping*** (“which hotel in Eilat for a family?”) — not reviewing.\n"
         "- The answers (comments) are a near 50/50 verdict machine: **385 recommend / 394 discourage**.\n"
         "- Booking, TripAdvisor & Google only ever see the **13% post-stay review**. The **demand** and the "
         "**peer verdict** that decide the booking are invisible to them — and to the hotels."),
    builtin("w_split", WX, 5, WW, 6, "content-type", "bar",
            "It's a demand feed: 84% are shopping, not reviewing", src="posts",
            desc="Recommendation requests dominate — the pre-booking signal no review site captures."),
    custom("w_features", WX, 11, WW, 7, "What travelers are demanding (and you should be advertising)",
           "bar", {"dimension": "custom:requested_features", "metric": "post_count",
                   "barOrientation": "horizontal", "topN": 12, "includeOthers": False},
           src="posts",
           desc="The features people explicitly ask for. Family-friendly + pool + value + breakfast lead."),
    text("w_funnel", WX, 18, WW, 5, "The two-metric funnel (this is the product)",
         "Every hotel gets two numbers Booking can't give them:\n\n"
         "**① Share of Consideration** *(from posts)* — when people shop your city + segment, "
         "**are you even in the room?**\n\n"
         "**② Verdict Net** *(from comments)* — once you're named, **does the crowd talk people "
         "toward you or away?** `(recommends − discourages)`\n\n"
         "> The 2×2 writes itself: *in the room but losing the argument* = urgent, fixable, highest "
         "willingness to pay. *Great verdict, never named* = a marketing problem. *Losing both* = triage."),
    custom("w_city", WX, 23, WW, 7, "Where the demand is (shopping conversations by city)",
           "bar", {"dimension": "custom:hotel_mentions.city", "metric": ASK,
                   "barOrientation": "horizontal", "topN": 10, "includeOthers": False},
           src="posts",
           desc="Eilat is the single biggest demand pool, then Jerusalem & Tel Aviv."),
    text("w_king", WX, 30, WW, 7, "🏨 Case study: King Solomon — the dashboard that lies",
         "King Solomon (Eilat) is doing fine by every metric a hotel actually pays for. "
         "Booking shows a respectable score. **The conversation tells the opposite story:**\n\n"
         "- **In the room:** named in **4 of 49** Eilat shopping conversations — solid consideration.\n"
         "- **Loses the argument:** comment **Verdict Net = −5** — **24 recommend vs 29 discourage.** "
         "When real travelers ask, the crowd talks *more people out of it than into it.*\n\n"
         "> **They're bleeding bookings at the recommendation step — and their dashboard says they're "
         "fine.** That gap, made visible and fixable, is what they'll pay for."),
    text("w_leaderboard", WX, 37, WW, 8, "The verdict: who wins and loses the room",
         "Net sentiment from **1,012 peer answers** (recommend − discourage):\n\n"
         "| 🟢 Winners | Net | | 🔴 Losers | Net |\n"
         "|---|---:|---|---|---:|\n"
         "| **Royal Garden** | **+45** | | **Gordonia** | **−41** |\n"
         "| Royal Beach | +30 | | Sea Side | −13 |\n"
         "| Goma Kinneret | +16 | | Galei Kinneret | −13 |\n"
         "| Isrotel Ayala | +10 | | Dan Panorama | −9 |\n"
         "| Notza | +9 | | King Solomon | −5 |\n\n"
         "> **Royal Garden is the benchmark** (55 recommend / 10 discourage). **Gordonia is radioactive** "
         "(3 / 44). None of this is visible on the channels these hotels currently watch."),
    W("w_top", WX, 45, WW, 9, aggregation="embeds", chartType="embed",
      title="The raw conversations (the actual posts)",
      description="Live, ranked by reach — the unfiltered demand the report is built on.",
      embedConfig={"source": "collection", "display": "grid", "rankBy": "view_count", "count": 6}),
    text("w_bottom", WX, 54, WW, 5, "🔑 Bottom line",
         "> **Booking is the rear-view mirror. This is the deal happening now.**\n\n"
         "Review platforms see only the **13%** who already stayed. This report sees the **84%** still "
         "deciding *and* the peer verdict that sways them. Sell it as one number per hotel — **Share of "
         "Consideration** — plus the demand features they're failing to advertise. The reputation "
         "leaderboard is the tier-2 upsell. The demand blind-spot is the wedge: **no one else has it.**"),
    text("w_method", WX, 59, WW, 3, "Method",
         "Source: public FB group *מדברים על בתי מלון בישראל* (109.5K). One collection — **198 posts** "
         "judged on-topic + **1,012 comments** enriched (the peer answers). Each mention classified for "
         "hotel, city, stance & requested features by an LLM pass. Demo sample; scales with cadence. "
         "All widgets read on-topic data via the scope layer."),
]

# ── SHORT COLUMN (x=8, w=4): the at-a-glance numbers ────────────────────────
short = [
    custom("s_posts", SX, 0, 2, 3, "Shopping posts", "number-card",
           {"metric": "post_count"}, src="posts"),
    custom("s_comments", SX + 2, 0, 2, 3, "Crowd verdicts", "number-card",
           {"metric": "post_count"}, src="comments"),
    custom("s_demand", SX, 3, SW, 7, "Posts: shopping vs reviewing", "doughnut",
           {"dimension": "custom:hotel_mentions.stance", "metric": ASK}, src="posts",
           desc="“asking” = active demand. It dwarfs the verdicts in the posts themselves."),
    custom("s_trip", SX, 10, SW, 6, "Who's traveling", "doughnut",
           {"dimension": "custom:trip_context", "metric": "post_count"}, src="posts",
           desc="Families are the dominant shopping segment."),
    custom("s_verdict", SX, 16, SW, 7, "Comments: the crowd's verdict", "doughnut",
           {"dimension": "custom:hotel_mentions.stance", "metric": ASK}, src="comments",
           desc="In the answers, recommend vs discourage runs ~50/50 — a real verdict signal."),
    builtin("s_sentiment", SX, 23, SW, 6, "sentiment", "doughnut",
            "Tone of the answers", src="comments",
            desc="Sentiment of the peer verdicts."),
]

LAYOUT = wide + short

REPORT_CONFIG = {
    "canonicalization": [
        {"id": "c_zichron", "canonical": "Zichron Ya'akov",
         "members": ["zichron yaakov", "zichron ya'akov", "zikhron yaakov"],
         "fields": ["custom:hotel_mentions.city"]},
        {"id": "c_kinneret", "canonical": "Sea of Galilee",
         "members": ["sea of galilee", "galilee", "kinneret"],
         "fields": ["custom:hotel_mentions.city"]},
    ],
    "valueColors": {
        "custom:hotel_mentions.stance": {
            "recommend": "#16a34a", "discourage": "#dc2626",
            "neutral": "#9ca3af", "asking": "#2563eb"},
        "sentiment": {"negative": "#dc2626", "neutral": "#9ca3af", "positive": "#16a34a"},
        "custom:trip_context": {
            "family": "#2563eb", "couples": "#db2777",
            "group_event": "#f59e0b", "unspecified": "#9ca3af"},
    },
}
FILTER_BAR = ["sentiment", "platform", "date_range", "content_type"]


def main() -> int:
    validated = []
    for w in LAYOUT:
        obj = SocialDashboardWidget(**w)
        if obj.x + obj.w > GRID_COLS:
            raise SystemExit(f"widget {w['i']}: x+w={obj.x+obj.w} > {GRID_COLS}")
        validated.append(obj)
    if validated and all(w["x"] == 0 and w["w"] <= 4 for w in LAYOUT):
        raise SystemExit("collapsed-mobile layout rejected")
    rc = ReportConfig(**REPORT_CONFIG)
    serialized = [o.model_dump(exclude_none=True, by_alias=True) for o in validated]
    serialized_rc = rc.model_dump(exclude_none=True, by_alias=True)

    tcount = sum(1 for w in LAYOUT if w["aggregation"] == "text")
    echart = sum(1 for w in LAYOUT if w["aggregation"] == "embeds")
    print(f"✓ {len(validated)} widgets valid ({tcount} text + {echart} embed + "
          f"{len(validated)-tcount-echart} chart); {len(REPORT_CONFIG['canonicalization'])} canon groups")
    print(f"  wide height={max(w['y']+w['h'] for w in wide)}  short height={max(w['y']+w['h'] for w in short)}")
    for w in LAYOUT:
        cc = w.get("customConfig", {})
        print(f"   [{w['x']:>2},{w['y']:>2} {w['w']}x{w['h']}] {w['aggregation']:<12} {w['chartType']:<11} "
              f"{w.get('dataSource','posts'):<8} {w['title'][:30]:<30} {cc.get('metric',''):<26} {cc.get('dimension','')}")

    if "--apply" not in sys.argv:
        print("\nDRY RUN. Re-run with --apply.")
        return 0

    fs = get_fs()
    now = datetime.now(timezone.utc).isoformat()
    fs._db.collection("dashboard_layouts").document(LAYOUT_ID).set({
        "user_id": USER_ID, "artifact_id": LAYOUT_ID, "title": TITLE,
        "layout": serialized, "filterBarFilters": FILTER_BAR, "orientation": "vertical",
        "reportScope": None, "filterBarHidden": False, "reportConfig": serialized_rc,
        "is_template": False, "updated_at": now,
    }, merge=True)
    fs._db.collection("explorer_layouts").document(LAYOUT_ID).set(
        {"title": TITLE, "updated_at": now}, merge=True)

    db = fs._db.collection("dashboard_layouts").document(LAYOUT_ID).get().to_dict()
    assert len(db["layout"]) == len(validated) and db["reportConfig"]["canonicalization"]
    print(f"\n✓ Updated dashboard {LAYOUT_ID} ({len(db['layout'])} widgets) in Explorer tab → agent {AGENT_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
