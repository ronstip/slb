"""Build/update the hydration-breaks dashboard report (Explorer tab) in PROD.

Edits the existing layout in place (same layout_id) via the save-endpoint doc
shape + guardrails. Adds reach/engagement widgets (views/likes), a multimodal
top-posts embed, sharper text, a bottom line, and an X-post-ideas section.

All widget data flows through the scope TVF (is_related_to_task IS TRUE) by
design — no per-widget relevance filter.

Usage: uv run python scripts/oneoff_build_hydration_dashboard.py [--apply]
"""

import os, sys
from datetime import datetime, timezone
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))
for _l in open(_root/".env"):
    _l=_l.strip()
    if _l and not _l.startswith("#") and "=" in _l:
        _k,_,_v=_l.partition("="); os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from api.deps import get_fs
from api.routers.dashboard_schema import SocialDashboardWidget, ReportConfig, GRID_COLS

AGENT_ID = "a951fe8c-a9ba-4666-81fe-89bb0d41fa3b"
USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
LAYOUT_ID = "fcc53b26bb614f289d673196a8551afd"   # edit in place
TITLE = "Hydration Breaks — Public Opinion (WC 2026)"
WX, WW, SX, SW = 0, 8, 8, 4


def W(i, x, y, w, h, **kw): return {"i": i, "x": x, "y": y, "w": w, "h": h, **kw}
def text(i, x, y, w, h, title, md):
    return W(i, x, y, w, h, aggregation="text", chartType="table", title=title,
             markdownContent=md, manualHeight=True)
def custom(i, x, y, w, h, title, ct, cfg, desc=None):
    d = W(i, x, y, w, h, aggregation="custom", chartType=ct, title=title, customConfig=cfg)
    if desc: d["description"] = desc
    return d

REACH = "143.7M views · 8.3M likes · 1.1M shares"

# ── WIDE COLUMN (x=0, w=8): text + charts ──────────────────────────────────
wide = [
    text("w_thesis", WX, 0, WW, 4, "The verdict: fans aren't buying it",
         "> **FIFA's mandatory hydration breaks have lost the room — and it isn't close.**\n\n"
         "Across **537 on-topic posts** on X, Instagram & TikTok (15–22 Jun), reaching "
         f"**{REACH}**:\n\n"
         "- **66% opposed**, just **4% in favour** — and opposition owns **the majority of the views**, not just the volume.\n"
         "- The top emotion is **frustration**; the top format is the **meme**.\n"
         "- The real grievance isn't water — it's that breaks fire even in **air-conditioned stadiums**, read as an **ad-revenue play** that **kills momentum**."),
    custom("w_args", WX, 4, WW, 7, "Why the backlash — and what actually travels",
           "bar", {"dimension": "custom:argument_frame", "metric": "post_count",
                   "metricToggle": ["post_count", "view_count", "engagement_total"],
                   "barOrientation": "horizontal", "topN": 8, "includeOthers": True},
           desc="Toggle mentions → views → engagement. 'Cash-grab' and 'momentum' lead; memes (other) top reach."),
    text("w_engines", WX, 11, WW, 4, "Two engines drive the anger — and memes are the amplifier",
         "**① \"Commercial cash-grab.\"** Breaks open fresh ad inventory — **Powerade, Adidas, "
         "Coca-Cola** and FIFA itself are the brands most pulled into the conversation.\n\n"
         "**② \"Momentum killer.\"** A whistle 22 minutes in lets a losing coach regroup and stalls the game.\n\n"
         "**The amplifier:** derisive **memes/jokes** — coded \"other/neutral\" on stance but clearly "
         "anti — generate the **single largest slice of reach (54.6M views)**. The joke *is* the argument."),
    custom("w_daily", WX, 15, WW, 7, "Daily conversation by stance",
           "bar", {"dimension": "posted_at", "timeBucket": "day", "metric": "post_count",
                   "breakdownDimension": "custom:stance_on_breaks", "stacked": True},
           desc="Opposition is steady day over day; volume peaked 20 Jun."),
    text("w_battle", WX, 22, WW, 4, "The battle map: who's on each side",
         "**Against** ⚔️ — **Virgil van Dijk** (the loudest critic), **Marcelo Bielsa**, "
         "**Lionel Scaloni**, Jürgen Klopp, Gary Neville.\n\n"
         "**Defending** 🛡️ — **Gianni Infantino** (FIFA president) and pundit **Alexi Lalas**, on player-welfare grounds.\n\n"
         "**Split** — **Kylian Mbappé** (\"don't ask players, we're reactionary\"). The named-figure discourse skews clearly anti."),
    custom("w_voices", WX, 26, WW, 7, "Most-cited public figures",
           "bar", {"dimension": "custom:notable_voices.name",
                   "metric": "customobj:notable_voices.__count",
                   "barOrientation": "horizontal", "topN": 12},
           desc="Counted per named figure across posts (no per-post double-count)."),
    W("w_top", WX, 33, WW, 9, aggregation="embeds", chartType="embed",
      title="Top posts by reach (what fans actually saw)",
      description="Live, ranked by views — multimodal: the most-viewed take is an IG video at 15M.",
      embedConfig={"source": "collection", "display": "grid", "rankBy": "view_count", "count": 6}),
    text("w_bottom", WX, 42, WW, 5, "🔑 Bottom line",
         "> **This isn't a vocal minority — it's a consensus, and it's winning the reach war.**\n\n"
         "Opposition holds **two-thirds of the conversation** and the **majority of 143M views**, while "
         "support barely registers (**2.5% of reach**). The breaks have become a lightning rod for a bigger "
         "grievance — that **FIFA is monetizing the game at fans' expense**. It's already spreading as a "
         "cautionary tale: **UEFA has publicly ruled the breaks out for Euro 2028**. If FIFA wants the "
         "narrative back, the fight to win is **commercialization**, not hydration."),
    text("w_postideas", WX, 47, WW, 7, "📣 X post ideas (RT · multimodal · agentic)",
         "**① The capability flex.**\n"
         "> *\"We pointed ONE agent at the World Cup's most-hated new rule. In 7 days it read **928 posts** "
         "across X, TikTok & Instagram, decoded every take, and called it: **66% against, 143M views of "
         "backlash.** Fans don't hate the water — they hate the ads. 🧵\"*\n"
         "➜ **Attach:** the *\"Why the backlash\"* bar (toggled to **views**). Shows **RT** (7-day fresh) + "
         "**multimodal** (3 platforms) + **agentic** (auto-read & classified at scale).\n\n"
         "**② The counter-intuitive story.**\n"
         "> *\"Memes aren't noise — they're the message. The most-viewed opinion on FIFA's hydration breaks "
         "wasn't a pundit. It was a **meme with 15M views.** Our agent didn't just count them — it read the "
         "image and pulled out the argument inside.\"*\n"
         "➜ **Attach:** the *Top posts by reach* embed (the multimodal grid). Shows **multimodal** "
         "(reads image/video memes) + **agentic** (infers intent), and it's a genuinely fun read."),
    text("w_method", WX, 54, WW, 3, "Method",
         "928 posts collected (X 381 · IG 300 · TikTok 247), 7-day window; **537 judged on-topic (~90%)** by "
         "an LLM relevance pass that rejects keyword collisions (cricket drinks breaks, beverage ads, "
         "memes-as-euphemism). Reach = de-duplicated views/likes/shares. All charts read on-topic posts via "
         "the scope layer."),
]

# ── SHORT COLUMN (x=8, w=4): charts only ───────────────────────────────────
short = [
    custom("s_views", SX, 0, 2, 3, "Total views", "number-card",
           {"metric": "view_count"}, ),
    custom("s_likes", SX+2, 0, 2, 3, "Total likes", "number-card",
           {"metric": "like_count"}),
    custom("s_stance", SX, 3, SW, 7, "Stance by reach (views)", "doughnut",
           {"dimension": "custom:stance_on_breaks", "metric": "view_count"},
           desc="Opposition dominates attention, not just count."),
    W("s_emotion", SX, 10, SW, 7, aggregation="emotion", chartType="bar",
      title="Emotional register", description="Frustration dominates."),
    W("s_ctype", SX, 17, SW, 6, aggregation="content-type", chartType="doughnut",
      title="How the take is expressed"),
    custom("s_brands", SX, 23, SW, 7, "Brands by reach", "bar",
           {"dimension": "brands", "metric": "view_count", "barOrientation": "horizontal", "topN": 8},
           desc="The commercial read, made concrete."),
    custom("s_platform", SX, 30, SW, 6, "Reach vs engagement by platform", "bar",
           {"dimension": "platform", "metric": "view_count",
            "metricToggle": ["view_count", "like_count"], "barOrientation": "horizontal"},
           desc="X = reach; TikTok over-indexes on likes."),
    custom("s_voice", SX, 36, SW, 6, "Who's talking", "doughnut",
           {"dimension": "custom:opinion_voice", "metric": "post_count"}),
]

LAYOUT = wide + short

REPORT_CONFIG = {
    "canonicalization": [
        {"id": "c_wc", "canonical": "World Cup 2026",
         "members": ["world cup 2026", "fifa world cup 2026", "world cup", "fifa world cup", "2026 world cup"],
         "fields": ["themes", "entities"]},
        {"id": "c_hb", "canonical": "Hydration breaks",
         "members": ["hydration breaks", "hydration break", "cooling breaks", "drinks break"], "fields": ["themes"]},
        {"id": "c_humor", "canonical": "Humor / satire",
         "members": ["humor", "satire", "meme"], "fields": ["themes"]},
        {"id": "c_comm", "canonical": "Commercialization",
         "members": ["commercialization of sports", "commercialization", "commercialism"], "fields": ["themes"]},
        {"id": "c_mbappe", "canonical": "Kylian Mbappé",
         "members": ["kylian mbappe", "kylian mbappé"], "fields": ["entities"]},
        {"id": "c_coke", "canonical": "Coca-Cola",
         "members": ["coca cola", "coca-cola"], "fields": ["brands"]},
    ],
    "valueColors": {
        "custom:stance_on_breaks": {"opposed": "#dc2626", "supportive": "#16a34a", "neutral": "#9ca3af", "mixed": "#f59e0b"},
        "sentiment": {"negative": "#dc2626", "neutral": "#9ca3af", "positive": "#16a34a"},
    },
}
FILTER_BAR = ["sentiment", "platform", "date_range", "content_type", "themes", "entities"]


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
        print(f"   [{w['x']:>2},{w['y']:>2} {w['w']}x{w['h']}] {w['aggregation']:<12} {w['chartType']:<12} "
              f"{w['title'][:34]:<34} {cc.get('metric',''):<14} {cc.get('dimension','')}")

    if "--apply" not in sys.argv:
        print("\nDRY RUN. Re-run with --apply.")
        return 0

    fs = get_fs()
    now = datetime.now(timezone.utc).isoformat()
    # Edit in place — mirrors POST /dashboard/layouts/{artifact_id} (merge=True)
    fs._db.collection("dashboard_layouts").document(LAYOUT_ID).set({
        "user_id": USER_ID, "artifact_id": LAYOUT_ID, "title": TITLE,
        "layout": serialized, "filterBarFilters": FILTER_BAR, "orientation": "vertical",
        "reportScope": None, "filterBarHidden": False, "reportConfig": serialized_rc,
        "is_template": False, "updated_at": now,
    }, merge=True)
    fs._db.collection("explorer_layouts").document(LAYOUT_ID).update({"updated_at": now})

    db = fs._db.collection("dashboard_layouts").document(LAYOUT_ID).get().to_dict()
    assert len(db["layout"]) == len(validated) and db["reportConfig"]["canonicalization"]
    print(f"\n✓ Updated dashboard {LAYOUT_ID} ({len(db['layout'])} widgets) in Explorer tab → agent {AGENT_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
