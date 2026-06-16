"""One-off: build a custom dashboard "Brief" for the Credit-Card-War agent that
AGGREGATES ON THE v9 CUSTOM ENRICHMENT FIELDS (brand_stance, in_market,
leaning_toward, main_topic, relevance_class), not a generic template.

Writes:
  - dashboard_layouts/{id}  : the layout (widgets + reportScope)
  - explorer_layouts/{id}   : {agent_id,...} -> makes it appear in the agent's
                              explorer dropdown (review URL printed at the end)

Charts render client-side from scope_posts(@agent_id).custom_fields, so the
object-field charts use the documented grammar:
  dimension  custom:brand_stance.<leaf>        (group elements by a leaf)
  metric     customobj:brand_stance.__count    (count of elements, no double-count)
Scalar custom fields use  dimension=custom:<field>.

Usage:  uv run python scripts/oneoff_build_cal_brief.py
"""

import os
import sys
import uuid
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))
for _l in (_root / ".env").read_text().splitlines():
    _l = _l.strip()
    if _l and not _l.startswith("#") and "=" in _l:
        _k, _, _v = _l.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip())

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

AGENT_ID = "22bee852-039c-40d9-80a6-4c44d074d1c9"
COLLECTION_ID = "2151c726-625d-42d7-8598-df7c552a47b1"
DATE_FROM, DATE_TO = "2026-06-02", "2026-06-14"

REL = {"relevance_class": ["core", "brand_signal"]}   # exclude off_topic
INMKT = {"in_market": ["true"]}


def _w(i, x, y, w, h, **kw):
    base = {"i": i, "x": x, "y": y, "w": w, "h": h}
    base.update(kw)
    return base


def _custom(i, x, y, w, h, title, dimension, *, metric="post_count", chartType="bar",
            breakdown=None, stacked=None, metricAgg=None, filters=None,
            barOrientation=None, topN=None, numberSize=None, description=None):
    cc = {"dimension": dimension, "metric": metric}
    if breakdown: cc["breakdownDimension"] = breakdown
    if stacked is not None: cc["stacked"] = stacked
    if metricAgg: cc["metricAgg"] = metricAgg
    if barOrientation: cc["barOrientation"] = barOrientation
    if topN: cc["topN"] = topN
    if chartType == "number-card":
        cc.pop("dimension", None)
    wd = _w(i, x, y, w, h, aggregation="custom", chartType=chartType, title=title,
            customConfig=cc)
    if filters: wd["filters"] = {"custom_fields": filters}
    if numberSize: wd["numberSize"] = numberSize
    if description: wd["description"] = description
    return wd


def _text(i, x, y, w, h, md, title="Text"):
    return _w(i, x, y, w, h, aggregation="text", chartType="bar", title=title,
              markdownContent=md, manualHeight=True)


# ─────────────────────────── narrative content ──────────────────────────────
TITLE_MD = """\
# Israel Travel-Card War — The Brief for Cal
### Public conversation, 2–14 June 2026 · El Al "Matmid / Fly Card" community (Facebook)

**Prepared for a Cal decision-maker.** 400 posts captured; **237 brand-relevant**. \
One thesis, three contrarian findings, a battle map, and three moves — all from \
what the public actually wrote. *Draft for internal review before client delivery.*"""

THESIS_MD = """\
## The thesis

**Isracard won the franchise but is losing the public — and the switch isn't settled.** \
In the most engaged El Al-loyalist community, Isracard draws **~83% negative** opinion \
(49 negative vs 10 positive mentions), while **Cal sits at roughly 50/50** (27 vs 23) and \
is the brand customers volunteer *praise* for. Crucially, of **130 buyers actively deciding \
right now, 60 are still undecided** — more than lean to Isracard (17) or Cal (9) combined. \
The window before the 1 Jan 2027 program change is Cal's last, best retention moment.

**Favorability map (opinionated mentions, brand-relevant posts):**

| Brand | 👍 positive | 🤔 considering | 👎 negative | net read |
| --- | --- | --- | --- | --- |
| **Isracard** | 10 | 40 | **49** | lightning rod — ~83% of opinion is negative |
| **Cal** | 23 | 25 | 27 | balanced; **2.3× Isracard's positive mentions** |
| **Max** | 5 | 3 | 2 | small, net-positive niche |
| **El Al** (airline) | 1 | – | 9 | blamed for the whole shift |
| **Diners / Amex** | mixed | – | acceptance gripes | network friction |

The charts below are computed live from the per-brand **stance** enrichment, so a single \
post that praises Cal *and* slams Isracard counts on both sides — the old single-sentiment \
field could never show this."""

FINDINGS_MD = """\
## Three contrarian findings

**1. The loudest brand is the least loved.** Isracard has the most mentions and the most \
"considering" interest, yet ~83% of opinion about it is negative. Its own onboarding chaos, \
fees, and a widely-shared "deception" perception are doing Cal's competitive work for it.

**2. Confusion — not preference — is moving customers.** The #1 conversation topic is \
**Transition Confusion (73 brand-relevant posts)**. People are defaulting toward Isracard \
because they don't understand FlyAll vs the new FlyCard or what happens on 1.1.27 — not \
because they prefer it. Clarity is therefore a *growth* lever, not just support hygiene.

**3. Service is Cal's moat.** Customer service is the dimension where Cal is consistently \
praised and Isracard consistently slammed (card-never-arrived, unreachable call centre, \
mis-sold sign-up gifts). In a points war that commoditizes fast, service is the one durable \
differentiator the public actually rewards."""

BATTLE_MD = """\
## The battle map — who owns what

- **Isracard** — owns *attention and dread*. Most discussed, most "considering", most \
disliked. Pain clusters: **fees** (membership-fee hikes, the 40₪ flashpoint), **onboarding \
& service** (cards not delivered, unreachable reps), and **trust** ("working us in the eyes").
- **Cal** — owns *trust and service*. The incumbent people are reluctant to leave; its \
FlyAll counter-offer is recognized but under-explained. Cal is **not immune** — a minority \
report sales-pressure and FlyAll confusion, so execution still matters.
- **Max (SkyMax)** — a small, quietly-satisfied niche; not yet a front in this war.
- **El Al** — the airline absorbs blame for the whole transition ("moved to Isracard to make \
more money, proved customers don't matter"), which spills negatively onto whoever issues the card.
- **Amex / Diners** — network-level friction (acceptance, premium-fee mechanics), secondary."""

MOVES_MD = """\
## Three moves for Cal

**Move 1 — Retention blitz on the persuadable middle, before 1.1.27.** \
Target the **60 undecided + 40 "considering-Isracard"** buyers now. Lead with the two things \
Cal wins on — **service + fee certainty** (the 40₪ membership fee is the single biggest \
friction in the data). Sample line: *"Stay with the service you already trust — no migration, \
no surprises, your points keep accruing."*

**Move 2 — Amplify the narrative the public is already writing.** \
The organic "**don't rush to Isracard — they overpaid for the franchise and are under \
financial pressure**" story is spreading on its own. Turn that earned skepticism into a \
credible "no need to switch in a panic" retention message.

**Move 3 — Kill the FlyAll confusion with one page.** \
Transition Confusion is the #1 topic and it currently *defaults customers to Isracard*. Ship \
a dead-simple "**what's changing / what you should do / what you keep**" explainer. Removing \
the confusion removes Isracard's biggest unearned advantage."""

QUOTES_MD = """\
## In their own words (translated)

**Anti-Isracard — trust & onboarding**
> "What really angered me is **Isracard working us in the eyes** — the FlyCard terms aren't \
what was sold." · "I ordered the Fly Card on the 5,000-point promo; **the physical card \
never came**. Called the centre again and again — still nothing."

**The organic 'don't rush' narrative (Cal's gift)**
> "Friends, **don't rush to Isracard**. They bought the franchise at an insane price — \
reportedly **100M+ ₪/yr more than Cal**, on a 10-year deal — and have already reported \
losses to the market this year. They're under pressure."

**Sign-up bait & switch**
> "Switched from Cal to Isracard; the rep said the **join gift is only for Amex sign-ups** \
(higher interchange for them). Now I find out I was owed it anyway."

**The other side — fee defenders / Cal not immune**
> "I don't get the fuss over the **40₪** fee — gold+ already gets lounge, baggage, upgrades, \
priority." · "Warning: **unprofessionalism bordering on fraud at Cal** — their WhatsApp \
service just punted me to a sales rep." (Cal must not take service trust for granted.)"""

METHOD_MD = """\
## Methodology & data quality

**Source.** One Facebook community — *El Al Matmid / Fly Card* — the most engaged \
El Al-loyalist audience. **400 posts, 2–14 June 2026**, deduped per post. Enrichment **v9** \
(per-brand stance + aspect, buyer-intent, decision-driver, 3-way relevance).

**What's solid.** Per-brand favorability, the in-market battleground, decision drivers, and \
topic mix are all derived from structured per-post stance — the charts above are live and \
filterable.

**Read with care (and what to fix next).**
- **Loyalist bias:** this is El Al's fan base, not the general public — sentiment toward El Al \
and Fly Card skews favourable here; treat absolute levels as directional.
- **No comments/replies captured** (top-level posts only) — the richest debate layer is missing.
- **No engagement metrics** captured this cycle, so reach/virality can't yet weight opinions.
- **12-day window.** For trend lines, widen the collection.

**Recommended next cycle:** add comment scraping + engagement + a second, non-loyalist source, \
then re-run v9 enrichment for a defensible market-wide read."""


def build_layout():
    W = []
    W.append(_text("t_title", 0, 0, 12, 3, TITLE_MD))
    # KPI number-cards (custom, post_count + filters)
    W.append(_custom("k_total", 0, 3, 3, 3, "Posts analyzed", None, chartType="number-card", numberSize="big"))
    W.append(_custom("k_rel", 3, 3, 3, 3, "Brand-relevant", None, chartType="number-card", filters=REL, numberSize="big"))
    W.append(_custom("k_inmkt", 6, 3, 3, 3, "In-market buyers", None, chartType="number-card", filters=INMKT, numberSize="big"))
    W.append(_custom("k_undec", 9, 3, 3, 3, "Undecided buyers", None, chartType="number-card",
                     filters={**INMKT, "leaning_toward": ["undecided"]}, numberSize="big"))
    # Thesis + findings
    W.append(_text("t_thesis", 0, 6, 12, 13, THESIS_MD))
    W.append(_text("t_find", 0, 19, 12, 9, FINDINGS_MD))
    # Custom-field charts row 1: brand share of voice + stance mix
    W.append(_custom("c_sov", 0, 28, 6, 7, "Share of voice by brand (stance mentions)",
                     "custom:brand_stance.brand", metric="customobj:brand_stance.__count",
                     chartType="bar", barOrientation="horizontal",
                     description="Counted per stance element — no post double-counts."))
    W.append(_custom("c_stance", 6, 28, 6, 7, "Overall stance mix",
                     "custom:brand_stance.stance", metric="customobj:brand_stance.__count",
                     chartType="doughnut"))
    # Topics stacked by sentiment (relevant only)
    W.append(_custom("c_topic", 0, 35, 12, 7, "Conversation topics (brand-relevant) by sentiment",
                     "custom:main_topic", metric="post_count", breakdown="sentiment", stacked=True,
                     chartType="bar", filters=REL))
    # Drivers + leaning
    W.append(_custom("c_aspect", 0, 42, 6, 7, "Decision drivers (what stance is about)",
                     "custom:brand_stance.aspect", metric="customobj:brand_stance.__count",
                     chartType="bar", barOrientation="horizontal"))
    W.append(_custom("c_lean", 6, 42, 6, 7, "Who in-market buyers lean toward",
                     "custom:leaning_toward", metric="post_count", chartType="bar", filters=INMKT))
    # Buyer intent + sentiment context
    W.append(_custom("c_inmkt", 0, 49, 6, 6, "Buyer intent (in-market?)",
                     "custom:in_market", metric="post_count", chartType="doughnut"))
    W.append(_custom("c_sent", 6, 49, 6, 6, "Sentiment mix (all posts)",
                     "sentiment", metric="post_count", chartType="doughnut"))
    # Battle map
    W.append(_text("t_battle", 0, 55, 12, 12, BATTLE_MD))
    # Daily volume by sentiment
    W.append(_custom("c_daily", 0, 67, 12, 7, "Daily volume by sentiment",
                     "posted_at", metric="post_count", breakdown="sentiment", stacked=True,
                     chartType="bar"))
    # custom timeBucket
    W[-1]["customConfig"]["timeBucket"] = "day"
    # Moves + quotes + methodology
    W.append(_text("t_moves", 0, 74, 12, 16, MOVES_MD))
    W.append(_text("t_quotes", 0, 90, 12, 14, QUOTES_MD))
    W.append(_text("t_method", 0, 104, 12, 12, METHOD_MD))
    return W


def main():
    settings = get_settings()
    fs = FirestoreClient(settings)
    agent = fs.get_agent(AGENT_ID) or {}
    user_id = agent["user_id"]

    widgets = build_layout()

    # validate against the real schema before writing
    from api.routers.dashboard_schema import DashboardLayout
    DashboardLayout(layout=widgets)
    print(f"OK: {len(widgets)} widgets validate against DashboardLayout")

    layout_id = uuid.uuid4().hex
    title = "Israel Travel-Card War — The Brief for Cal (2–14 Jun 2026)"
    doc = {
        "user_id": user_id,
        "artifact_id": layout_id,
        "layout": widgets,
        "filterBarFilters": ["sentiment", "date_range", "content_type", "language"],
        "orientation": "vertical",
        "title": title,
        "is_template": False,
        "source_template_id": None,
        "reportScope": {
            "collection": [COLLECTION_ID],
            "date_range": {"from": DATE_FROM, "to": DATE_TO},
        },
    }
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    fs._db.collection("dashboard_layouts").document(layout_id).set(doc)
    fs._db.collection("explorer_layouts").document(layout_id).set({
        "agent_id": AGENT_ID, "user_id": user_id, "title": title,
        "created_at": now, "updated_at": now,
    })
    # link as an agent artifact too (best-effort)
    try:
        fs.add_agent_artifact(AGENT_ID, layout_id)
    except Exception as e:
        print("note: add_agent_artifact skipped:", e)

    print("layout_id:", layout_id)
    print("REVIEW URL: /agents/%s?tab=explorer&layout=%s" % (AGENT_ID, layout_id))


if __name__ == "__main__":
    main()
