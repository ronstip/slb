"""Build the "version B" weekly intelligence report template.

Design philosophy - different from v3/v6, not a successor.

v3/v6 = research-paper structure: metadata → exec summary → SoV →
positioning → chronology → emotion → narratives (§9!) → platform → channel →
audience → risk → recs → appendix. Topics are buried 9th. Customer mental
model mismatch: a political/strategic-comms analyst opens the report wanting
to know "what's the story this week?" - the narratives ARE the story, not
a footnote after the chronology.

version B = customer mental model: a senior comms analyst opens the report
Monday morning with this ranked want-list:
  1. What's the story this week? (narratives)
  2. Who owns the conversation? (SoV + posture)
  3. Where am I exposed / where can I attack? (risk + opportunity)
  4. What do I do today? (recommendations)
  5. (optional, for analysts who drill in) timing, platform, methodology

So version B is split:

  LEAN FRONT - must-read, 30-second scan
    §1  TL;DR - the week in one short paragraph (written LAST after research)
    §2  Narratives in play - TOP - `topic_metrics` TVF
    §3  Who owns the conversation - `entity_metrics` TVF
    §4  How it's landing - sentiment shape + emblematic posts
    §5  Risk & opportunity board - synthesis from §2/§3
    §6  Recommendations (3-5) - action

  DEEP APPENDIX - optional drill-down for analysts
    §7  Timing & inflection - `daily_metrics` TVF
    §8  Distribution (platform / channel) - `window_metrics` + `scope_posts`
    §9  Stance & emotion deep dive - `custom_fields` + emotion
    §10 Methodology, data quality, external grounding

Key shifts from v6:
  - Narratives moved from §9 → §2 (the lead, not a footnote).
  - Every brief names THE EXACT TVF + EXACT columns to project. Removes
    agent guesswork; pre-aggregated SoV/SoV%/sentiment shapes come from
    the TVF, not hand-rolled GROUP BY (consistency + accuracy).
  - TL;DR widget at top - analyst can stop after 60s and have signal.
    Brief mandates specificity (named narratives, named actors, named
    inflection days; <100 words) - generic filler is a fail.
  - Risk & opportunity is a standalone strategic board, not folded into
    recs. Diagnosis section that the analyst can paste into a memo;
    recommendations below reference its rows.
  - 4 widgets dropped vs v6: positioning per-actor (§6), top posts pro/anti
    (§8a), tone/emotion correlation (§8b), audience cohorts (§12). Their
    value either folds into §3 (positioning) and §4 (top posts) or moves
    to optional appendix.

Anti-failure guardrails kept verbatim from v6:
  - Voice & tone block (senior intelligence analyst, decision-ready).
  - Event-date verification via web grounding (§2 within narratives).
  - "X drove Y" plausibility cross-check (§7 timing inflections).
  - No internal terminology in customer-facing sections (no TVF / tool
    names / "Entity Match" / "UNION" / etc; methodology lives in App-B).
  - Citation density: every claim earns its place with number/handle/post/
    link.
  - ≥3 distinct external hostnames + ≥5 grounded links in App-A.
  - SERP & fabricated-URL detection enforced by `verify_dashboard`.

Owner + agent-explorer wiring identical to v3/v6.

Usage:
    uv run python scripts/build_dashboard_template_version_b.py [--dry-run]
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

from scripts.build_dashboard_template_v3 import (  # noqa: E402
    VOICE,
    BODY_SKELETON,
    _chart_widgets,
)
from api.deps import get_fs  # noqa: E402

VERSION_B_TEMPLATE_ID = "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Data-source mandate (prepended into the SoV/narratives/landing briefs) ─

DATA_SOURCE_PRINCIPLE = (
    "**Data-source principle (load-bearing).** Numbers never come from "
    "head-math. Always SELECT them - from a TVF when one exists, from "
    "`scope_posts` when the cut is custom. Counting rows, summing series, "
    "normalizing percentages by mental arithmetic are all banned. The "
    "section briefs below name the exact TVF and exact column to project "
    "for each number. Use them."
)


# ─── Header & TOC ───────────────────────────────────────────────────────────

HEADER_MD = """# Intelligence Report (version B) - `<Subject>` (Week of `<YYYY-MM-DD>` → `<YYYY-MM-DD>`)

**Template version B.** Lean front (TL;DR · narratives · share-of-voice · landing · risk/opportunity · recommendations) followed by an optional deep dive (timing · distribution · stance/emotion · methodology). The agent reads this template, clones it into a hidden dashboard, fills every section, validates, and publishes.

Each text widget below carries (a) an instruction to the agent and (b) a compact reference example. At runtime the agent replaces both with the actual current-period analysis. Chart widget configs are frozen.
"""

TOC_MD = """<a id="sec-toc"></a>
## Table of contents

**Agent instructions.** A clean linked list of every section in order. Tight, no commentary. Mirror the actual section anchors used in the body.

**Anchor rule (load-bearing).** GitHub-flavored auto-anchors fail for non-Latin scripts. Place an explicit HTML anchor on its own line immediately above every section heading: `<a id="sec-N"></a>`. Reference these IDs in the TOC as `[Section title](#sec-N)`. Never link to the heading text itself. **Do not renumber after removal** - if a sub-widget is dropped, the surviving siblings keep their letters / numbers.

---

**Reference example.**

```markdown
## Table of contents

**Lean front**
1. [The week - TL;DR](#sec-1-tldr)
2. [Narratives in play](#sec-2-narratives)
3. [Who owns the conversation](#sec-3-sov)
4. [How it's landing](#sec-4-landing)
5. [Risk & opportunity board](#sec-5-riskopp)
6. [Recommendations](#sec-6-recs)
   - [6.1](#sec-6-1) · [6.2](#sec-6-2) · [6.3](#sec-6-3) · [6.4](#sec-6-4) · [6.5](#sec-6-5)

**Deep dive**
7. [Timing & inflection](#sec-7-timing)
8. [Distribution - platform & channel](#sec-8-distribution)
9. [Stance & emotion](#sec-9-stance)
10. [Methodology & external grounding](#sec-app)
```
"""


# ─── §1 - TL;DR / Headline ──────────────────────────────────────────────────

SEC_1_TLDR_MD = f"""<a id="sec-1-tldr"></a>
## 1. The week - TL;DR

{VOICE}

**Agent instructions.** Written LAST, after every other section is drafted. This widget is the single line the analyst forwards to a colleague - it must hold up alone.

**Hard requirements.**

1. **One short paragraph, 60–90 words.** Not bullets. Not a list. A paragraph.
2. **Specificity is the test.** Every sentence must name something concrete: a narrative by name, an actor by name, a post / day / number by value. *"A lot of activity around X this week"* is a fail. *"`<Rival1>` consolidated 36% share of voice on the back of three viral TikTok clips ((1.1M / 880K / 540K views) attacking `<Subject>` on `<TopicA>`; `<Subject>`'s response cluster reached 290K - a 6× under-amplification"* is a pass.
3. **Cover the four customer questions in order:** (a) what's the story this week, (b) who's winning the conversation, (c) where the exposure is, (d) the one thing to do Monday.
4. **No hedging adverbs.** No "appears to", "seems to", "could be argued". Lead the finding.
5. **One forward bullet - "What to read first".** A single one-line callout under the paragraph linking to the section that holds the load-bearing finding: e.g. `**What to read first.** [§2 - Narratives in play](#sec-2-narratives) - the `<Subject>`-mental-fitness cluster jumped from emerging to dangerous.`

**Forbidden in this widget.** Methodology, tool names, the words "this report", "in this analysis", "based on the data". The customer doesn't need the disclaimer - they paid for the analysis, they assume it's based on the data.

---

**Reference example (shape only - write fresh for the current period).**

`<Rival1>` consolidated 36% share of voice on the back of three TikTok clips (1.1M / 880K / 540K views) attacking `<Subject>` on `<TopicA>`; `<Subject>`'s response cluster reached 290K - a 6× under-amplification. The `<Subject>`-mental-fitness cluster moved from `emerging` to `dangerous` (78 posts, 690K views, lead voices @rival_outlet + @rival1). The 686K-view `<Rival2>` `<Event>` opening went uncollected - `<Subject>` published zero posts on it. Monday's first move: a counter-narrative arc on `<TopicA>` framed as `<RivalCamp>`-panic, executed before 09:00.

**What to read first.** [§5 - Risk & opportunity board](#sec-5-riskopp) - the `<Subject>`-mental-fitness cluster is the load-bearing risk this week.
"""


# ─── §2 - Narratives in play (THE LEAD) ─────────────────────────────────────

SEC_2_NARRATIVES_MD = f"""<a id="sec-2-narratives"></a>
## 2. Narratives in play

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** This is the lead section of the report - what is actually being said. Every other section reads through this one.

**Data source.** Call `list_topics` (which queries the `topic_metrics(@agent_id)` TVF). The TVF returns pre-computed cluster aggregates - *do not* re-aggregate by hand. Use these columns directly:

- `topic_id`, `topic_name`, `topic_summary`, `topic_keywords`
- `post_count`, `total_views`, `total_likes` *(pre-aggregated - paste verbatim)*
- `positive_pct`, `negative_pct`, `neutral_pct` *(pre-computed shares - paste verbatim, do not normalize)*
- `signal_score` *(use for ranking - already incorporates recency + reach + volume)*
- `sample_posts` *(top-5 engagement-weighted; use for "lead voices" + evidence)*

Rank rows by `signal_score` DESC. Take the **top 6–10 narratives**.

**Table schema (use exactly this - no extra columns, no dropped columns).**

| Narrative | Posts | Reach | Sentiment (P/N/M) | Lead voices | Momentum | Stance to subject |

- **Narrative** = `topic_name` + 1-line `topic_summary` paraphrase in body language.
- **Posts / Reach** = `post_count` / `total_views` from the TVF row.
- **Sentiment (P/N/M)** = `<positive_pct>% / <negative_pct>% / <neutral_pct>%` *(from the TVF - DO NOT recompute by summing your own breakdown)*.
- **Lead voices** = top 2–3 channel handles from `sample_posts`.
- **Momentum** = one of `emerging` / `sustained` / `fading` / `dangerous`. Decision rule:
  - `dangerous` = negative_pct > 60% AND signal_score in top quartile
  - `emerging` = first appearance OR signal_score jumped >2× vs prior cluster run
  - `fading` = post_count last 3 days < 25% of cluster total
  - `sustained` = anything else
- **Stance to subject** = `attacking` / `defending` / `neutral` / `mobilizing` - from a quick scan of the sample_posts AI summaries.

**Below the table - three short paragraphs.**

1. **The dominant story.** Single most important narrative this week - what it is, why it matters, who is pushing it. Cite at least one specific post by handle + views.
2. **The negative-momentum cluster.** Whichever narrative is `dangerous` - what makes it dangerous, who is amplifying it, where it is heading. This is the §5 (risk board) input.
3. **Cross-platform divergence.** Where the same narrative reads differently on different platforms (often the same actor reads completely different on each). 1–2 sentences.

Reference the word-cloud widget once.

**Date-verification for event-driven narratives (load-bearing).** When a cluster names a specific event ("party launch", "merger", "scandal", "appointment", "interview airs"), the event's actual date - verified against an independent news source via web grounding - goes in the body, not the date of the corpus post that mentioned it. Anniversary, commemorative, and recap posts come weeks after the actual event. Conflating post-date with event-date is the single most embarrassing failure mode of this report. If you cannot find an external source dating the event, write `~MM` (approximate month) and footnote the uncertainty - never invent precision. The verifying news URL belongs in §10 App-A.

**Forbidden in this widget.** Methodology terms (`topic_metrics`, `signal_score` as a literal column-name, `embedding`, `cluster recall`, `list_topics`). The customer reads narratives, not lab notes.

---

**Reference example (shape only).**

| Narrative | Posts | Reach | Sentiment (P/N/M) | Lead voices | Momentum | Stance to subject |
| :-------- | ----: | ----: | :---------------: | :---------- | :------- | :---------------- |
| `<Subject>` mental fitness - character attack on age / clarity | 78 | 690K | 6% / 81% / 13% | @rival_outlet, @rival1, @anon_clip | **dangerous** | attacking |
| Coalition launch + merger - branded as `<Subject>+<Ally>` | 142 | 1.2M | 64% / 14% / 22% | @subject, @ally1 | sustained | defending |
| `<Rival2>` `<Event>` - "responsible `<Wing>`" opening | 66 | 686K | 12% / 70% / 18% | @news1, @news2 | fading | neutral |
| `<TopicA>` policy positioning - hawkish frame | 51 | 1.1M | 58% / 21% / 21% | @subject, @subject_movement | emerging | mobilizing |

**The dominant story.** `<Rival1>`'s mental-fitness frame is the week's load-bearing narrative - 690K views, 81% negative, three high-reach amplifying accounts ([302K](https://x.com/...), [180K](https://x.com/...), [110K](https://x.com/...)) carrying it. Aggregate reach is 6× the response cluster.

**The negative-momentum cluster.** Mental-fitness is `dangerous` because it crossed the threshold into TikTok where pro-`<Subject>` voices are structurally smaller - the same content reads neutral on X (party-aligned discussion) and inflammatory on TikTok (visual-anchored, character-driven). It is not a single-platform problem.

**Cross-platform divergence.** Coalition launch reads as **strategy** on X (high pro/anti ratio, policy discussion) but as **personality / character** on TikTok (anti-subject emotional content). Narrative tools must be platform-specific.
"""


# ─── §3 - Share of Voice ────────────────────────────────────────────────────

SEC_3_SOV_MD = f"""<a id="sec-3-sov"></a>
## 3. Who owns the conversation

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** One table - every material actor, ranked by reach. The competitive landscape in one view.

**Discovery (MANDATORY before calling the TVF).** Sample what is actually in the `entities` array on `scope_posts` for the period:

```sql
SELECT LOWER(TRIM(entity)) AS entity_norm, COUNT(*) AS c
FROM social_listening.scope_posts(@agent_id), UNNEST(entities) AS entity
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY entity_norm
ORDER BY c DESC
LIMIT 100
```

Group the top entities into canonical clusters using only strings that appeared in the result. Surnames, nicknames, transliterations, party names - include every variant you saw. Match is exact-equality after `LOWER(TRIM())` - substring won't work.

**Data source.** Call `entity_metrics(@agent_id, @groups, @period_start, @period_end, NULL)` once with every material actor. The TVF returns these columns - paste verbatim, do not recompute:

- `entity` (NOT `canonical` - the TVF projects `canonical AS entity`)
- `post_count`, `total_reach`
- `sov_views` *(corpus-grounded share - paste as percent, **DO NOT re-normalize by summing the table's reach column**)*
- `pos_mentions`, `neg_mentions`, `neu_mentions`
- `net_sentiment` *(pre-computed; use for the trend glyph)*
- `top_content_type`, `top_emotion`, `first_mention`, `last_mention`

**Table schema (use exactly this).**

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Trend | Posture |

- **SoV %** = `sov_views` from the TVF row, formatted as percent. Row sums > 100% are expected (multi-actor posts) - see the math footnote below.
- **Trend** glyph + word from `net_sentiment` thresholds (uniform across all rows):
  - `▲ <positive-word>` when `net_sentiment > +0.10`
  - `▬ <mixed-word>` when `−0.10 ≤ net_sentiment ≤ +0.10`
  - `▼ <negative-word>` when `net_sentiment < −0.10`
  Localize the word into the data's language (Hebrew: חיובי / מעורב / שלילי · English: positive / mixed / negative).
- **Posture** = a 1-word strategic frame: `leading` / `defending` / `attacking` / `flanking` / `silent` / `over-amplified`. Derive from reach rank × pro/anti ratio × top_content_type:
  - `over-amplified` = top 3 by reach AND pro:anti worse than 1:2
  - `silent` = post_count < 10 in scope (named-but-not-active actor)
  - `attacking` = top_emotion in `{{anger, disgust}}` AND neg_mentions / post_count > 0.5
  - `defending` = top_content_type in `{{statement, press_release}}` AND pos_mentions / post_count > 0.4
  - `leading` = #1 or #2 by reach with stable pro/anti AND not `over-amplified`
  - `flanking` = anything else

**Math footnote (mandatory, exactly this shape - one line below the table).**

> *Corpus reach: `<N>` · Actor-reach sum: `<M>` · Multiplier: `<M÷N>×` · Average mentions per post: `<avg>`. Explains the >100% row sum.*

Compute `<avg>` from:
```sql
SELECT ROUND(AVG(ARRAY_LENGTH(entities)), 2) AS avg_entities_per_post
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND ARRAY_LENGTH(entities) > 0
```

**Below the table - 2–3 short paragraphs.** Volume-vs-reach leaders, worst pro/anti ratio, who is silent, who is over-amplified relative to organic support, who has the cleanest profile. Each claim grounded in a row of the table.

Reference the SoV stacked-bar widget once.

**Forbidden in this widget.** No `entity_metrics`, no "Entity Match", no "two-signal UNION" methodology language. The reader sees rows + math footnote + interpretation. Methodology is App-B.

---

**Reference example (shape only).**

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Trend | Posture |
| :---- | ----: | ----: | ----: | :--------------------: | :---: | :------ |
| `<Rival1>` | 509 | 8.13M | 36.0% | 136 / 344 | ▼ negative | over-amplified |
| `<Subject>` | 362 | 4.64M | 20.5% | 85 / 249 | ▼ negative | defending |
| `<Rival2>` | 266 | 2.17M |  9.6% | 46 / 204 | ▼ negative | flanking |
| `<Rival3>` | 217 | 1.77M |  7.8% | 59 / 132 | ▬ mixed | flanking |
| `<Ally1>` | 88 | 412K |  1.8% | 38 / 22 | ▲ positive | leading |

*Corpus reach: 22.6M · Actor-reach sum: 24.1M · Multiplier: 1.07× · Average mentions per post: 1.12. Explains the >100% row sum.*

**Strategic read.** `<Rival1>`'s reach lead rests on a single viral TikTok mechanic (one clip = 43% of his weekly reach); his pro/anti ratio (1:2.5) is the worst in the field. `<Subject>` holds a clean #2 with the same negative trend but a less concentrated reach profile. The four trailing actors together produce 20.7% - less than `<Subject>` alone, but the `<Ally1>` row is the only positive-trend cell in the table.
"""


# ─── §4 - How it's landing ──────────────────────────────────────────────────

SEC_4_LANDING_MD = f"""<a id="sec-4-landing"></a>
## 4. How it's landing

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Sentiment shape across the corpus, plus the posts that landed best and worst this period. The customer's gut-check section.

**Data source - overall shape.** Call `window_metrics(@agent_id, @period_start, @period_end, @timezone)` once. From the returned single row use directly:

- `total_posts`, `total_views`, `total_engagement`, `engagement_rate`
- `positive_pct`, `negative_pct`, `neutral_pct` *(paste verbatim)*
- `top_emotions` *(JSON array of `{{emotion, count, pct}}` - use top 3)*
- `top_posts` *(JSON array of top-10 by reach - use top 3 pro + top 3 anti)*

**Data source - top/bottom posts.** Two queries on `scope_posts`:

```sql
-- Best-performing PRO posts (highest reach with positive sentiment)
SELECT post_id, channel_handle, platform, content_type, posted_at, views, likes, content, post_url, ai_summary
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND sentiment = 'positive'
ORDER BY views DESC LIMIT 5

-- Worst-landing posts FOR the subject (highest-reach negative posts about the subject)
SELECT post_id, channel_handle, platform, content_type, posted_at, views, likes, content, post_url, ai_summary
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND sentiment = 'negative'
  AND EXISTS (SELECT 1 FROM UNNEST(entities) e WHERE LOWER(TRIM(e)) IN UNNEST(@subject_variants))
ORDER BY views DESC LIMIT 5
```

**Structure.**

1. **Sentiment shape - one short paragraph.** Open with the corpus sentiment split (paste `positive_pct / negative_pct / neutral_pct`). Name the top 3 emotions from `top_emotions` and their reach-weighted contribution. Say what the shape implies tactically - anger-driven (high reach, low conversion), trust-driven (lower reach, higher conversion), etc.

2. **Top posts the customer should know about - two tables.**

   **Top reach (pro-side).** 5 rows. Schema:

   | Date | Platform | Account | Views | Likes | Link | What was said | Why it landed |

   **Top reach (anti-subject).** 5 rows. Same schema with last column = **Counter-move**.

   - Quoted message in original language, 1 line.
   - `Link` is `[view](post_url)` - actual database `post_url`. Missing URL = `-` and footnote the missing-URL count.
   - `Why it landed` / `Counter-move`: one sharp line - what worked, or what to do about it.

**Forbidden.** Methodology phrases (`window_metrics`, `top_emotions JSON`). Recompute-by-hand of percentages already in the TVF row.

---

**Reference example (shape only).**

**Sentiment shape.** Corpus split is 24% positive / 58% negative / 18% neutral - anger and disgust dominate the top emotions (combined 41% reach-weighted). The shape is anger-driven, which produces high reach but converts poorly into mobilization; the trust-anchored content `<Subject>` did post (14 posts, avg 92K reach) consistently out-performed his anger-tagged posts (7 posts, avg 18K).

**Top pro-side posts (excerpt).**

| Date | Platform | Account | Views | Likes | Link | What was said | Why it landed |
| :--- | :------: | :------ | ----: | ----: | :--: | :------------ | :------------ |
| MM-DD | X | @subject | 1.27M | 38K | [view](https://x.com/...) | "`<one-line message>`" | Coherent two-name brand, foreign-policy anchor, 07:30 post-time |

**Top anti-subject posts (excerpt).**

| Date | Platform | Account | Views | Likes | Link | What was said | Counter-move |
| :--- | :------: | :------ | ----: | ----: | :--: | :------------ | :----------- |
| MM-DD | X | @rival_outlet | 302K | 3.3K | [view](https://x.com/...) | "`<attack message>`" | Avoid direct reply; pivot to `<TopicA>` via 19:00 quote-card |
"""


# ─── §5 - Risk & opportunity board ──────────────────────────────────────────

SEC_5_RISKOPP_MD = f"""<a id="sec-5-riskopp"></a>
## 5. Risk & opportunity board

{VOICE}

**Agent instructions.** A two-column strategic board. **Synthesis only - no new data**; the rows refold §2's `dangerous`-momentum narratives + §3's vulnerable / over-amplified actors into Risks, and §2's `emerging`-momentum narratives + opponent weak spots into Opportunities. The recommendations in §6 reference these rows by name.

Each row names a SPECIFIC item (not a category) with a specific evidence pointer back to an earlier section.

**Risks table.**

| Risk | Driver narrative / actor (cite §) | Urgency | Window to act |

- **Urgency:** `critical` / `high` / `medium` / `low`. Use `critical` sparingly - not every red row is critical. Reserve for narratives that meet two conditions: `dangerous` momentum AND crossing into a platform/cohort where the subject is structurally under-amplified.
- **Window to act:** a date range or one of `<24h` / `<48h` / `<72h` / `this week` / `this month`. "Soon" is not a window.

**Opportunities table.**

| Opportunity | Source (cite §) | Estimated upside | Window to act |

- **Estimated upside:** a number or reach band ("0.3–0.5M earned reach"), not "big".
- **Source:** which §2 narrative / §3 actor / §4 post the opportunity surfaces from.

**Below both tables - one short closing paragraph.** The board's strategic framing in 3–4 sentences: which risk is load-bearing, which opportunity is most time-sensitive, and the asymmetry between them (e.g. risks are clustered around character attacks while opportunities cluster around policy positioning - that ratio tells the campaign where to spend the next 48 hours).

**Hard rules.**

1. **No item without a section pointer.** Every row cites the §2 narrative or §3 actor or §4 post that surfaced it.
2. **No abstract risks.** "Reputational risk" is not a row. "`<Subject>`-mental-fitness narrative consolidating into `<RivalCamp>` doctrine (see §2)" is a row.
3. **Risks and opportunities are not symmetric.** Don't pad to make the columns even - if there are 4 risks and 2 opportunities, the table reflects that.

---

**Reference example (shape only).**

**Risks.**

| Risk | Driver narrative / actor (cite §) | Urgency | Window to act |
| :--- | :-------------------------------- | :------ | :------------ |
| `<Subject>`-mental-fitness frame consolidates into `<RivalCamp>` doctrine | §2 narrative `dangerous` (78 posts, 690K) · §3 @rival1 over-amplified | **critical** | <48h |
| TikTok anti-skew compounds with no `<Subject>` TikTok answer | §2 cross-platform note · §3 `<Subject>` posture defending | high | this week |
| `<Ally1>` is the only positive-trend voice in §3 - single point of failure | §3 row - leading but isolated | medium | this month |

**Opportunities.**

| Opportunity | Source (cite §) | Estimated upside | Window to act |
| :---------- | :-------------- | :--------------- | :------------ |
| `<Rival2>` `<Event>` - "responsible `<Wing>`" reframe | §2 narrative `fading` (686K organic anger, uncollected) | 0.3–0.5M earned reach | <48h |
| `<TopicA>` policy positioning - hawkish frame is emerging | §2 narrative `emerging` (1.1M reach, mobilizing stance) | 0.5–1M earned reach if cadenced | this week |

**Strategic framing.** The board is asymmetric - three risks vs. two opportunities, and the load-bearing risk (mental-fitness frame) is on the character axis while both opportunities are on the policy axis. The campaign's next 48 hours should be split: a defensive counter-narrative on the character axis (consuming roughly 60% of message capacity) and an offensive cadence on `<TopicA>` (the other 40%). `<Rival2>` `<Event>` is a free shot - high upside, no opposition cost - and should be claimed first because the news cycle is fading.
"""


# ─── §6 - Recommendations ───────────────────────────────────────────────────

SEC_6_RECS_INTRO_MD = f"""<a id="sec-6-recs"></a>
## 6. Recommendations

{VOICE}

**Agent instructions for the whole §6.** Up to five operational recommendations. Each lives in its own sub-section widget (6.1 through 6.5). **Remove unused sub-widgets** via `update_dashboard(layout_id, removals=[...])` rather than filling with placeholders. Do not renumber after removal - 6.4 stays 6.4 even if 6.3 was dropped.

Each recommendation must reference a specific risk or opportunity row from §5. A recommendation with no §5 anchor is not allowed.

Required content per recommendation:

1. **Defensive or Offensive tag** - a one-word frame at the top of the widget.
2. **Justification** - cite the §5 row + the underlying §2 / §3 / §4 evidence by section.
3. **Execution plan** - calendar table: `Day | Time | Channel | Format | Template`. Time windows are specific ("09:00–09:30"), not vague ("morning").
4. **Target accounts for amplification** - named handles, with one-line "why this account".
5. **Success KPI** - specific threshold AND time window.

Generic recommendations ("increase engagement", "use more video") fail the specificity test and must be cut.

**Order matters.** Rank recommendations by (i) urgency from §5, then (ii) reach-payoff. The first widget (6.1) is the Monday-morning action.
"""

SEC_6_X_MD_TEMPLATE = f"""<a id="sec-6-{{n}}"></a>
### 6.{{n}} - `<headline matching §5 row {{n}}>`

{VOICE}

**Type:** `<Defensive | Offensive>`

**Agent instructions.** Expand §5 row {{n}} into a full operational plan. If §5 has fewer than {{n}} rows worth acting on, REMOVE this widget - do not fill with placeholder content.

Required structure:

- **Justification (cite §5, plus §2 / §3 / §4 evidence).** Specific findings from earlier sections.
- **Execution plan** - calendar table: `Day | Time | Channel | Format | Template`.
- **Target accounts for amplification.** Named handles, with one-line "why this account".
- **Success KPI.** Specific threshold and time window.

---

**Reference example.**

**Type:** Defensive

**Justification (§5, §2, §3, §4).** §5 critical risk: `<Subject>`-mental-fitness frame consolidating. Underlying: §2 `dangerous` narrative (78 posts, 690K, 81% negative); §3 over-amplified `<Rival1>`; §4 top anti post @rival_outlet at 302K. Response cluster reach is 290K - 6× under-amplified.

**Execution plan - 72h cadence.**

| Day | Time | Channel | Format | Template |
| :-- | :--: | :------ | :----- | :------- |
| Day 1 | 08:00 | @subject (X) | text thread, 4 posts | "Three falsehoods, three corrections" |
| Day 1 | 19:00 | @subject_movement + 4 aligned influencers | quote-card image | Side-by-side comparison |
| Day 2 | 09:00 | @subject_tiktok | 45s on-camera video | Direct response, no studio set |

**Target accounts for amplification:** @ally1 (3.2M followers, center-`<wing>`, prior alignment ratio 0.81), @ally2 (1.4M, military-rank credibility), @ally3 (890K, reservist base) - confirmed via §3 SoV-adjacent analysis.

**Success KPI.** Cumulative reach ≥ 600K within 72h (2× the original attack). Sentiment ratio on the mental-fitness narrative shifts from 1:5 (pro:anti) to ≥ 1:2.
"""


# ─── DEEP DIVE divider ──────────────────────────────────────────────────────

DIVIDER_MD = """---

# Deep Dive

*The sections below are optional drill-downs for analysts who want the underlying picture. The lean front above (§1–§6) is the decision-ready report. Skip from here straight to §10 Methodology if you only want to verify the data.*

---
"""


# ─── §7 - Timing & inflection ───────────────────────────────────────────────

SEC_7_TIMING_MD = f"""<a id="sec-7-timing"></a>
## 7. Timing & inflection

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** The shape of the period - daily volume + the 2–3 days that changed it.

**Data source.** Call `daily_metrics(@agent_id, @period_start, @period_end, @timezone)` once. It returns one row per date (sparse days included). From each row use directly:

- `date`, `posts`, `views`, `engagement`
- `positive_pct`, `negative_pct`, `neutral_pct`
- `top_emotion`, `top_entities`, `top_themes`, `top_channels` *(JSON top-N - use for inflection drill-down)*

**7a. Day-by-day table.**

| Date | Posts | Reach | Pro / Anti | Top emotion | Daily inflection (one line) |

Every day in the period appears, even sparse days. Mark blanks `-` rather than dropping the row. The agent does NOT generate the date series - `daily_metrics` already includes empty days.

**7b. Inflection points - 2–3 days that changed the shape.**

Each inflection is a short paragraph, not a row. Cites specific posts (date, time, platform, account, views - pull from `top_posts` JSON in `window_metrics` or query `scope_posts` for the day).

**Two non-negotiable rules.**

1. **Event-date verification.** When a daily inflection names an event ("merger announced", "interview airs"), use the event's verified actual date - see §2's date-verification rule. A post on day Y about a week-ago event is reinforcement, not the inflection itself.

2. **Plausibility cross-check (silent, MANDATORY).** For every claim of the form *"X drove the spike on day Y"*, run ONE query before writing it:

```sql
SELECT platform, COUNT(*) AS posts, SUM(views) AS reach
FROM social_listening.scope_posts(@agent_id)
WHERE DATE(posted_at) = DATE '<Y>'
GROUP BY platform
ORDER BY reach DESC
```

If X's share of day Y's reach is < 30%, the claim is wrong - rewrite. **The cross-check happens silently** - do not write the word "cross-check" / "*בדיקת הצלבה*" in the prose. State the operational result: instead of *"Cross-check confirms TikTok contributed 66%"*, write *"TikTok carried 66% of the day's reach, almost entirely from three @60minutes clips"*.

Reference the daily-volume line chart on the dashboard once.

---

**Reference example.**

**7a. Day-by-day.**

| Date | Posts | Reach | Pro / Anti | Top emotion | Daily inflection |
| :--- | ----: | ----: | :--------: | :---------- | :--------------- |
| MM-DD | 391 | 4.1M | 95 / 130 | anger | Counter-attack lands - 3 anti posts at 590K combined |
| MM-DD | 368 | 3.4M | 82 / 121 | sadness | Foreign-press interview airs (verified airdate, see §2) |
| MM-DD | - | - | - | - | sparse - only N posts; weekend |

**7b. Inflection points.**

- **MM-DD: counter-attack lands.** Three pro-`<RivalCamp>` posts ([302K](https://x.com/...), [180K](https://x.com/...), [110K](https://x.com/...)) carry the `<AttackLine>` frame on X - 71% of the day's reach. `<Subject>`'s response (50K views) is 6× under-amplified.
- **MM-DD: foreign-press interview lands.** The actual interview aired on `<DATE-verified>` (see §2); the corpus spike on this day is the Hebrew-language repackaging - three @60minutes-clipped TikTok cuts together produce 66% of the day's reach.
"""


# ─── §8 - Distribution (platform + channel) ─────────────────────────────────

SEC_8_DISTRIBUTION_MD = f"""<a id="sec-8-distribution"></a>
## 8. Distribution - platform & channel

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Where reach concentrates and who is amplifying it. Two sub-sections (`###` headers).

**8a. Platform asymmetry.** Use this query (one shot - agent does not pre-aggregate by hand):

```sql
SELECT
  platform,
  COUNT(*) AS posts,
  SUM(views) AS reach,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS post_share_pct,
  ROUND(SUM(views) * 100.0 / SUM(SUM(views)) OVER (), 1) AS reach_share_pct,
  ROUND(COUNTIF(sentiment='positive') * 100.0 / COUNT(*), 1) AS pos_pct,
  ROUND(COUNTIF(sentiment='negative') * 100.0 / COUNT(*), 1) AS neg_pct
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY platform
ORDER BY reach DESC
```

Table schema:

| Platform | Posts | Post share % | Reach share % | Pro % | Anti % | Audience implication |

One paragraph below the table naming the asymmetry: which platform punches above its post-share, where sentiment is most hostile, where the subject is structurally under-amplified.

If the corpus is single-platform, REMOVE this sub-section.

Reference the Sentiment Mix doughnut + Platform Mix bar (side-by-side widgets below).

**8b. Top channels / amplifiers.** The Top Channels table widget on the dashboard pulls the data - **interpret, don't re-table**. Two short paragraphs:

1. **Who is amplifying the subject.** Top 3–5 channels from the widget that carry pro-subject content. Cite handles. Identify official / media / UGC / influencer classifications using `channel_type`.

2. **Missed amplification.** 2–4 UGC accounts or media outlets that consistently amplify *adjacent* messaging (same `channel_type` + similar prior `entities`) but did NOT amplify the subject this period. Use:

```sql
-- adjacent accounts not active this period
SELECT channel_handle, COUNT(*) AS prior_posts, MAX(posted_at) AS last_post
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start - INTERVAL 60 DAY AND @period_start
  AND EXISTS (SELECT 1 FROM UNNEST(entities) e WHERE LOWER(TRIM(e)) IN UNNEST(@subject_variants))
  AND channel_handle NOT IN (
    SELECT DISTINCT channel_handle FROM social_listening.scope_posts(@agent_id)
    WHERE posted_at BETWEEN @period_start AND @period_end
  )
GROUP BY channel_handle
ORDER BY prior_posts DESC LIMIT 10
```

List 3–5 handles + the post they could have amplified but didn't. This is the §6 amplification-target input.

Reference the Top Channels table widget once.

---

**Reference example.**

**8a. Platform asymmetry.**

| Platform | Posts | Post share % | Reach share % | Pro % | Anti % | Audience implication |
| :------- | ----: | -----------: | ------------: | ----: | -----: | :------------------- |
| Twitter (X) | 1,748 | 71.2% | 62.5% | 34.1% | 41.2% | Older, news-reading, party-aligned; debate-heavy |
| TikTok | 709 | 28.8% | 37.5% | 22.8% | 51.4% | Younger, virality-driven; **+10pts anti-incumbent skew** |

TikTok carries 1.3× its post-share in reach but +10 pts more anti-sentiment than X. The platform that grows fastest is also where the subject is most vulnerable; reach growth on TikTok without tone correction risks net-negative results.

**8b. Top channels.**

The pro-subject amplification base is concentrated: @subject_main (12 posts, avg 342K reach), @subject_movement (8 posts, avg 98K), and four aligned accounts (@ally1, @ally2, @ally_outlet, @reservist_handle) provide 78% of the pro-side reach. UGC pickup is thin - only 14 unaffiliated accounts crossed 50K reach with pro-subject content this period.

**Missed amplification.** @adjacent1 (prior alignment ratio 0.83, 47 posts in last 60d) silent this week; @adjacent2 (prior alignment ratio 0.76) posted on `<UnrelatedTopic>` instead of the launch.
"""


# ─── §9 - Stance & emotion ──────────────────────────────────────────────────

SEC_9_STANCE_EMOTION_MD = f"""<a id="sec-9-stance"></a>
## 9. Stance & emotion

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Two sub-sections. The stance cut depends on the agent's `custom_fields`; the emotion cut on enrichment coverage. Remove either sub-section if its data is missing - confident silence beats false synthesis.

**9a. Stance distribution.** Surface the most informative `custom_fields.<field>` distribution given the user's framing (e.g. `candidate_stance`). Discover the field by sampling:

```sql
SELECT key, COUNT(*) AS occurrences
FROM social_listening.scope_posts(@agent_id),
UNNEST([
  KEYS(custom_fields)  -- pseudo; use the agent's actual custom-field key set
]) AS key
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY key
ORDER BY occurrences DESC
```

Then the stance distribution itself:

```sql
SELECT
  JSON_EXTRACT_SCALAR(custom_fields, '$.<field>') AS value,
  COUNT(*) AS posts,
  ROUND(SUM(views) / COUNT(*)) AS avg_reach,
  COUNTIF(sentiment='positive') AS pro,
  COUNTIF(sentiment='negative') AS anti
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND JSON_EXTRACT_SCALAR(custom_fields, '$.<field>') IS NOT NULL
GROUP BY value
ORDER BY posts DESC
```

Table schema:

| Stance | Posts | Avg reach / post | Sentiment (Pro / Anti) |

**Translate raw `custom_fields` keys to human phrases in the data's language.** Raw snake_case keys (`pro_bibi`, `anti_bennett`) never appear in customer-facing cells.

Below the table - one short paragraph (not labeled "Reconciliation note", not "Methodology", just a short paragraph) interpreting the gap between organic supporters and amplification-machine posts.

If the agent has no `custom_fields`, REMOVE this sub-section.

**9b. Emotion correlation on subject's own content.** When `emotion` enrichment is available, count which emotions on the SUBJECT'S OWN posts correlate with reach. The implication is for tone next period.

```sql
SELECT emotion, COUNT(*) AS posts, ROUND(AVG(views)) AS avg_reach, SUM(views) AS total_reach
FROM social_listening.scope_posts(@agent_id)
WHERE channel_handle IN UNNEST(@subject_handles)
  AND posted_at BETWEEN @period_start AND @period_end
  AND emotion IS NOT NULL
GROUP BY emotion
ORDER BY avg_reach DESC
```

| Emotion | Posts | Avg reach / post | Total reach | Implication |

One sentence below stating the dominant high-performing emotion + the recommendation for tone next period.

If `emotion` non-null coverage on the subject's posts is < 50%, REMOVE this sub-section and note in §10 App-B.

---

**Reference example.**

**9a. Stance distribution.**

| Stance | Posts | Avg reach / post | Sentiment (Pro / Anti) |
| :----- | ----: | ---------------: | :--------------------- |
| pro-`<Subject>` (organic supporters) | 70 | 14,958 | 56 / 12 |
| anti-`<Subject>` (rival camp amplification) | 103 | 5,685 | 0 / 103 |
| pro-`<Rival>` | 109 | 35,356 | 88 / 17 |
| anti-`<Rival>` | 264 | 11,131 | 1 / 263 |

Of `<Subject>`'s 449 corpus mentions, only 70 are organic supporters; the rest is the rival camp's amplification machine. `<Rival>`'s ratio is inverted - his supporters out-amplify his attackers by 2.5×.

**9b. Emotion correlation on subject's own content.**

| Emotion | Posts | Avg reach / post | Total reach | Implication |
| :------ | ----: | ---------------: | ----------: | :---------- |
| trust | 14 | 92,000 | 1.29M | High-performing tone - keep cadence |
| anger | 7 | 18,000 | 126K | Under-performs trust 5× - pull back |
| excitement | 5 | 71,000 | 355K | Strong on launch posts only |

The subject's reach concentrates in trust-anchored posts. Anger-tagged content under-performs by 5×. Recommendation: anger-tagged posts only when the news cycle demands them, not as a default tone.
"""


# ─── §10 - Methodology & external grounding ─────────────────────────────────

APPENDIX_MD = f"""<a id="sec-app"></a>
## 10. Methodology, data quality & external grounding

{VOICE}

**Agent instructions.** ONE appendix in two clearly-named parts, separated by `###` sub-headers. Do not split into two widgets.

---

### A. External grounding (independent sources only)

**Strict rule - corpus platforms are FORBIDDEN here.** No `x.com`, `twitter.com`, `tiktok.com`, `youtube.com`, `instagram.com`, `facebook.com` links. The corpus posts those platforms produced are NOT external grounding - they are the data. External grounding means independent journalism, polls, market research, third-party reports, official statements off-platform.

**Minimum: ≥3 distinct external hostnames, ≥5 total links.** If web grounding cannot produce ≥3 distinct news/poll/report domains, the report is not actually grounded - re-run web grounding before publishing.

- Each entry: one-line summary, markdown link `[label](url)`, and the specific section it grounds (e.g. "grounds §2 mental-fitness narrative date", "grounds §7 MM-DD inflection event date").
- Group by type when there are enough (Polls / Press / Market / Official / Regulatory).
- **Run web grounding for every event-driven narrative in §2** - the article you used to date the event belongs here.
- A source that doesn't connect to a specific body finding doesn't earn its place.

**SERP and placeholder URLs rejected.** `google.com/search?q=…`, `bing.com/search?q=…`, `…/sample-url`, `example.com`, etc. are forbidden and `verify_dashboard` rejects them.

---

**Reference example.**

#### Press
- **[`<Outlet1>` - "<Headline>" (2026-MM-DD)](https://www.outlet1.example/article-id).** Reports the announcement of `<Event>`; **grounds §2 verified event-date and §7 inflection MM-DD**.
- **[`<Outlet2>` - "<Headline2>" (2026-MM-DD)](https://www.outlet2.example/article).** Attack-line coverage; **grounds §2 narrative `<cluster>`**.

#### Polls
- **[`<Pollster>` - `<Poll-Topic>` (2026-MM-DD)](https://www.pollster.example/polls/2026-05).** `<Subject>` bloc projected at 36 seats vs. `<Rival1>` 27; **grounds §3 SoV strategic read**.

#### Market / context
- **[`<Institution>` - `<Report>` (2026-Q2)](https://www.institution.example/reports/q2-2026).** 31% trust in `<institution>`; **grounds §8 audience implication**.

---

### B. Methodology, data sources & data quality

**Agent instructions.** Plain operational language. Describe what was done, not just which functions were called. Internal tool names (`topic_metrics`, `entity_metrics`, `window_metrics`, `daily_metrics`, `scope_posts`, `list_topics`, `execute_sql`) MAY appear here - but each is paired with a plain-language explanation.

Cover:

- **Data scope** - agent ID, source-collection count.
- **Period** - exact start / end timestamps + timezone.
- **Corpus** - total posts (raw / dedup), platform mix, language mix.
- **Statistics layer** - name the TVFs used (`topic_metrics` for §2, `entity_metrics` for §3, `window_metrics` for §1+§4, `daily_metrics` for §7). One line each on what the TVF returns and why it was used. *This is the only section in the entire report where the TVF names are allowed.*
- **Classification** - how sentiment / stance / emotion / themes were derived. Plain language alongside any code-named field.
- **External sources consulted** - count and brief description with link back to Part A.
- **Data-quality scoreboard** (REQUIRED) - per-field non-null coverage:

| Field | Non-null % | Notes |
| :---- | ---------: | :---- |
| sentiment | 98.4% | Standard 3-class |
| emotion | 92.1% | 7 categories |
| entities | 76.3% | Exact-name extraction |
| custom_fields.<field1> | 88.7% | Stance enrichment |
| themes | 95.5% | |

Query template for the scoreboard:
```sql
SELECT
  ROUND(COUNTIF(sentiment IS NOT NULL) * 100.0 / COUNT(*), 1) AS sentiment_pct,
  ROUND(COUNTIF(emotion IS NOT NULL) * 100.0 / COUNT(*), 1) AS emotion_pct,
  ROUND(COUNTIF(ARRAY_LENGTH(entities) > 0) * 100.0 / COUNT(*), 1) AS entities_pct,
  ROUND(COUNTIF(ARRAY_LENGTH(themes) > 0) * 100.0 / COUNT(*), 1) AS themes_pct,
  ROUND(COUNTIF(custom_fields IS NOT NULL) * 100.0 / COUNT(*), 1) AS custom_fields_pct
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
```

- **Known data gaps** - platforms missing, periods sparse, voices absent, enrichment fields not populated. Be specific. **Confident silence beats false synthesis.** If a finding upstream was hedged because of a data gap, name the gap here.
- **Sub-section removals** - list which optional widgets were dropped this run (§8a single-platform corpus, §9a no custom_fields, §9b emotion coverage <50%, §6.{{n}} unused recommendations) and why.
"""


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


def build_layout() -> list[dict]:
    charts = {w["i"]: w for w in _chart_widgets()}

    seq: list[dict] = [
        _text("vbhdr0000a", HEADER_MD, h=3),
        _text("vbsec00toc", TOC_MD, h=14),
        # 4 KPI cards (same as v3/v6 - totals + engagement rate)
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        # LEAN FRONT
        _text("vbsec01tld", SEC_1_TLDR_MD, h=14),
        _text("vbsec02nar", SEC_2_NARRATIVES_MD, h=30),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("vbsec03sov", SEC_3_SOV_MD, h=30),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("vbsec04lnd", SEC_4_LANDING_MD, h=26),
        _text("vbsec05rsk", SEC_5_RISKOPP_MD, h=24),
        _text("vbsec06int", SEC_6_RECS_INTRO_MD, h=8),
        _text("vbsec06r01", SEC_6_X_MD_TEMPLATE.format(n=1), h=18),
        _text("vbsec06r02", SEC_6_X_MD_TEMPLATE.format(n=2), h=18),
        _text("vbsec06r03", SEC_6_X_MD_TEMPLATE.format(n=3), h=18),
        _text("vbsec06r04", SEC_6_X_MD_TEMPLATE.format(n=4), h=18),
        _text("vbsec06r05", SEC_6_X_MD_TEMPLATE.format(n=5), h=18),
        # DEEP DIVE divider
        _text("vbdivider1", DIVIDER_MD, h=4),
        # DEEP APPENDIX
        _text("vbsec07tim", SEC_7_TIMING_MD, h=24),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("vbsec08dst", SEC_8_DISTRIBUTION_MD, h=22),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("vbsec09stn", SEC_9_STANCE_EMOTION_MD, h=22),
        _text("vbsecapp00", APPENDIX_MD, h=34),
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
        if w.get("aggregation") == "text":
            w_ = {**w, "x": 1, "y": y, "w": 10}
        else:
            w_ = {**w, "x": 0, "y": y, "w": w.get("w", 12)}
        out.append(w_)
        y += w_["h"]
        i += 1
    return out


def write_template(dry_run: bool) -> None:
    layout = build_layout()
    title = "Intelligence Report - Template version B"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"version B layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN - not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(VERSION_B_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": VERSION_B_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    now_iso = "2026-05-16T12:00:00+00:00"
    db.collection("explorer_layouts").document(VERSION_B_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote version B template: dashboard_layouts/{VERSION_B_TEMPLATE_ID}")
    print(f"Wrote version B explorer entry: explorer_layouts/{VERSION_B_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
