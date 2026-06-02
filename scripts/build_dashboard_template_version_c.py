"""Build the "version C - Brief" intelligence report template.

A completely re-imagined layout, not a successor to v6 or version B. The
mental model is the senior strategist's MEMO + the Stratechery / Bloomberg
longread, not the research-paper section grid.

Layout (top -> bottom):

  HERO
    Header                         (title + period)
    4 KPI cards                    (totals · reach · engagement · sentiment net)
    Thesis card                    (one bolded sentence + 3 hero numbers + period-delta)
    Daily-volume chart             (pulled up so thesis card "Look at:" has a target)

  WOW
    What you'd miss                (up to 3 contrarian findings up top)
    Battle Map                     (single grid: window × risk/opp)
    The Moves                      (up to 3 sibling widgets - sample copy mandatory)

  THE STORY
    The Longread                   (single 1500-2000 word essay)

  THE NUMBERS (evidence)
    Narratives                     (topic_metrics)         + word-cloud
    Share of voice                 (entity_metrics)        + stacked bar
    Daily timing                   (daily_metrics)         + line chart
    Top posts pro+anti             (window_metrics top_posts)
    Platform & channel             (scope_posts GROUP BY)  + sentiment + platform doughnuts + top channels
    Stance + Emotion deep          (custom_fields + emotion) - both removable

  CLOSE
    Methodology, data quality & external grounding   (combined App)

Anti-failure guardrails kept from v6/B:
  - Voice/tone block (senior intel analyst, decision-ready).
  - Event-date verification (load-bearing - in the longread brief AND timing).
  - "X drove Y" plausibility cross-check (timing).
  - No internal terminology in customer-facing sections.
  - Citation density.
  - >=3 distinct external hostnames, >=5 grounded links.
  - SERP / fabricated URL detection enforced by verify_dashboard.

Owner + agent-explorer wiring identical to v3/v6/version B.

Usage:
    uv run python scripts/build_dashboard_template_version_c.py [--dry-run]
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

VERSION_C_TEMPLATE_ID = "c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


DATA_SOURCE_PRINCIPLE = (
    "**Data-source principle (load-bearing).** Numbers never come from "
    "head-math. Always SELECT them - from a TVF when one exists, from "
    "`scope_posts` when the cut is custom. Counting rows, summing series, "
    "normalizing percentages by mental arithmetic are all banned."
)


# ─── HERO ───────────────────────────────────────────────────────────────────

HEADER_MD = """# `<Subject>` - The Brief (`<YYYY-MM-DD>` → `<YYYY-MM-DD>`)

**A briefing memo for a senior decision-maker.** One thesis. Three contrarian findings most readers would miss. A battle map of risk vs. opportunity by time window. Three moves with the actual copy to ship. A long-read that argues the period. Numbers and methodology at the back.

This is not a section-by-section research paper. It is an argument - supported by data - about what this period meant and what to do next.
"""


THESIS_MD = f"""<a id="sec-thesis"></a>
## The thesis

{VOICE}

**Agent instructions.** This widget is the most important block in the entire report. It will be read in <10 seconds by a senior decision-maker on their phone. Everything else exists to support it.

**Hard structure - exactly four pieces, in this order:**

1. **The thesis sentence.** ONE sentence. Bolded. **Maximum 25 words.** Names a subject, names an actor, names a frame, points at a window. It is an argument, not a summary. *"`<Subject>` is being defined by `<Rival1>`'s mental-fitness frame - 48 hours to flip it before it sets."* is a pass.

   **Anti-patterns - every one of these is an automatic fail:**
   - Generic week-could-be-any-week openers: *"This week saw significant activity…"*, *"`<Subject>` faces challenges and opportunities…"*, *"Multiple narratives competed for attention…"*.
   - Two-clause hedge sentences: *"`<X>` is rising but `<Y>` is also a factor."* - pick a side.
   - "Activity" / "discussion" / "engagement" as the subject of the sentence. Real actors, not abstractions.
   - Anything that would still be true if the period numbers were entirely different.
   - Anything over 25 words. Count them.

2. **The three numbers.** Three lines, each starting with a bold number, each ending with a one-line caption. The numbers must be specific enough that a competitor reading the report would learn something they did not know. Format:
   - **`<NUMBER1>`** - `<caption - what this number is and why it matters in 10 words>`
   - **`<NUMBER2>`** - `<caption>`
   - **`<NUMBER3>`** - `<caption>`

   Each number must be a SINGLE number (a percentage, a count, a multiplier) - not a range, not a date, not a name. The caption ends with no period and reads as a clause, not a sentence.

3. **The period-over-period delta.** Compare this period's headline metrics against the PRIOR period of equal length. Three short lines:
   - SoV: `<Subject>` `<arrow>` `<delta>` pts (now `<X>%`, prior `<Y>%`)
   - Net sentiment: `<Subject>` `<arrow>` `<delta>` pts (now `<X>`, prior `<Y>`)
   - Volume on `<dominant-platform>`: `<arrow>` `<delta>%`

   Arrows: ↗ (favorable to subject), ↘ (unfavorable), → (flat). Choose direction by how it cuts for the subject, not by raw sign. Threshold flat: `|delta|` <0.05 pts on sentiment, <2% on SoV, <10% on volume.

   **Prior-period fallback (load-bearing).** Run `window_metrics` with prior-period bounds = `(period_start - duration, period_start)`. If the prior-period query returns < 30% of the current-period post volume, the corpus does not cover prior-week reliably - replace the delta block with a one-line caveat: *"Prior-period baseline is sparse (<N> posts vs <M> this period); period-over-period delta omitted."* Do not invent baselines. Do not compare against a non-comparable window (e.g. don't compare 5-day window against 7-day prior).

4. **The one chart to look at.** A one-line callout pointing at the single supporting chart in the report that, if removed, would weaken the thesis most: e.g. `**Look at:** the daily-volume line directly below - the gap on `<MM-DD>` is the thesis in one image.` The chart you call out must actually be present in the dashboard.

**Forbidden in this widget.** Bullet lists that are not the three numbers and the three delta lines. Any sentence starting with "This week...", "In this period...", "Activity was...", "Several...". Hedging adverbs (*appears*, *seems*, *somewhat*, *could be argued*, *broadly*). Methodology. The word "report".

**Anti-redundancy rule.** The thesis sentence must be DIFFERENT from the load-bearing claim that *What-you'd-miss* finding #1 makes, AND different from the longread's kicker. Three places, three load-bearing arguments. If you find yourself writing the same finding three times, the thesis is too narrow - broaden it, or the contrarian finding is not contrarian enough - replace it.

**Data sources.** Run `window_metrics(@agent_id, @period_start, @period_end, @tz)` for the current numbers; run it again with the prior-period bounds for the delta. The three hero numbers are picked from the report - not necessarily from `window_metrics` - choose whichever three are most load-bearing.

---

**Reference example (shape only - DO NOT paste verbatim).**

**`<Rival1>` is winning the week on volume but losing it on conversion - and the `<Subject>`-mental-fitness frame has 48 hours before it sets as doctrine.**

- **36.0%** - `<Rival1>`'s share of voice this period, up 4.2 pts; one TikTok clip is 43% of his reach.
- **6×** - Reach gap between the mental-fitness attack cluster (690K) and the subject's response cluster (110K).
- **+27 pts** - Anti-subject sentiment on TikTok vs. X. The platform the campaign cannot reach is the one consolidating.

**Period-over-period delta.**
- SoV: `<Subject>` ↗ +2.1 pts (now 20.5%, prior 18.4%)
- Net sentiment: `<Subject>` ↘ −0.18 (now −0.41, prior −0.23)
- Volume on TikTok: ↗ +38%

**Look at:** the daily-volume line below - the gap on 05-08 is the thesis in one image.
"""


# ─── WOW ────────────────────────────────────────────────────────────────────

WHAT_YOUD_MISS_MD = f"""<a id="sec-miss"></a>
## What you'd miss

{VOICE}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Up to three findings. Each one is something a reader scanning the surface charts would NOT notice - cases where the obvious reading is wrong, or where a quiet signal matters more than a loud one. **Two strong findings beat three padded ones.** If only two hold up under scrutiny, write two and finish. Never write a fourth.

**Anti-redundancy rule (load-bearing).** None of these findings may restate the thesis sentence or the longread's kicker. They are complementary, not redundant. If finding #1 is the same claim as the thesis, replace it.

**Each finding is exactly four lines:**

1. **A bolded one-line claim** that flips the obvious read. ("**`<Rival1>` is over-amplified, not winning.**" / "**The biggest signal this week is silence - `<expected-voice>` posted zero times.**" / "**The viral clip is a lagging indicator; the real shift happened three days earlier.**")
2. **One short paragraph (35-60 words) of mechanism** - *why* the obvious read is wrong, in the smallest number of words.
3. **One inline evidence row** - a specific cited number / handle / post URL / quote from the corpus that anchors it. Format: `Evidence: <number or quote> · [post](<post_url>) · @<handle> · <views> views · <date>`.
4. **One implication** - a single line on what this means for the subject's next move. ("Implication: `<one-line operational take>`.")

**Finding shapes - NUMERIC TRIGGERS (use these as a search heuristic across the data; each finding must match one shape with the trigger cited inline).**

- **Shape A - Over-amplified actor.** TRIGGER: one of (a) a single post accounts for ≥ 30% of an actor's weekly reach, OR (b) one channel handle accounts for ≥ 50%. Cite the concentration ratio explicitly in the mechanism paragraph. The SoV table sees the actor as a leader; this finding shows the leadership is brittle.
- **Shape B - Silent voice.** TRIGGER: a handle with ≥ 10 prior-60-day posts on subject-aligned content AND zero posts this period. Cite the prior-60-day count + last-post date. Source from the missed-amplification SQL in the platform brief.
- **Shape C - Cross-platform divergence.** TRIGGER: same cluster / actor with sentiment delta ≥ 25 percentage points between two platforms (e.g. X 71% positive vs. TikTok 28% positive on the same launch cluster), OR reach-share inversion (>50% reach on one platform, < 15% on the other). Cite both platforms' posts + reach + sentiment.
- **Shape D - Response-mistaken-for-event.** TRIGGER: a daily-spike day where ≥ 60% of the day's reach is content that REFERENCES an earlier-day post (not the original event). Cite the root post date + the spike date + the day-N reach concentration ratio.

**Mix shape variety across the three findings.** At most two findings of the same shape. Three Shape-A findings is a fail of imagination.

**What does NOT count.**

- "Sentiment is negative." (Obvious from KPI strip.)
- "`<Top entity>` is dominating share of voice." (Obvious from chart.)
- "TikTok is rising." (Obvious from daily chart.)
- Anything a sentence-long summary of the topic-cluster table or SoV table would already show.
- Any finding whose evidence row has no concrete number from one of the four TRIGGER formulas above.

**Forbidden.** Methodology vocabulary (TVF, topic_metrics, signal_score, embedding, cluster recall). Hedging language. Findings without a specific evidence row.

---

**Reference example (shape only).**

1. **`<Rival1>` is over-amplified, not winning.** His 36% SoV rests on a single 1.1M-view TikTok clip - 43% of his weekly reach is one post by one handle. Strip that clip and his reach is below `<Subject>`'s. The "leader" reading is brittle.
   - Evidence: 1.10M views · [post](https://www.tiktok.com/...) · @rival1_main · 1.1M views · 2026-MM-DD
   - Implication: do not respond to the clip - wait it out. Responding rebuilds the reach floor he otherwise loses.

2. **The biggest signal this week is `<Ally_outlet>`'s silence.** The outlet posted 47 subject-aligned items in the prior 60 days but zero this week. The amplification machine that carried the prior cycle has gone quiet - without explanation.
   - Evidence: 47 prior posts · 0 this period · @ally_outlet · last-post 2026-MM-DD (10 days ago)
   - Implication: a private call to the outlet's editor today is worth more than any public move.

3. **The Tuesday spike is a *response*, not an *event*.** The 4.1M-view day reads as a counter-attack on the surface; the original `<RivalCamp>` frame post (302K, [link](https://x.com/...)) was actually Sunday and went un-answered. Tuesday is amplification, not initiation.
   - Evidence: Sunday root post 302K views · Tuesday three-post amplification 4.1M reach combined
   - Implication: post-mortems should target Sunday's response gap, not Tuesday's volume.
"""


BATTLE_MAP_MD = f"""<a id="sec-battle"></a>
## The battle map

{VOICE}

**Agent instructions.** A single grid. Rows are TIME WINDOWS. Columns are RISKS and OPPORTUNITIES. Each cell is a specific named item with a one-line action - NOT a category. If a cell has nothing concrete, leave it blank (`-`). Do not pad to fill the grid.

**Synthesis only - no new data.** The cells refold the findings already established in *What you'd miss*, the Narratives table, and the SoV table. Every cell carries a pointer to the supporting block: `(see ↓ narratives - `<topic_name>`)` / `(see ↓ SoV - @rival1)` / `(see ↑ what-you'd-miss #2)`.

**Grid schema (exactly these four rows, exactly these two columns):**

| Window | Risk → counter-move | Opportunity → claim |
| :----- | :------------------ | :------------------ |
| **<24h** | `<named item>` → `<one-line action>` | `<named item>` → `<one-line action>` |
| **<72h** | `<named item>` → `<action>` | `<named item>` → `<action>` |
| **this week** | `<named item>` → `<action>` | `<named item>` → `<action>` |
| **this month** | `<named item>` → `<action>` | `<named item>` → `<action>` |

After the grid, **one short closing paragraph (40–80 words)** that names:
- which row is the load-bearing one (where the asymmetry between risk and opportunity is widest),
- the message-capacity split implied by the grid (e.g. *"60% of the next 48 hours' message capacity goes to the <24h risk; the remaining 40% claims the <72h opportunity"*),
- and the one thing that, if it slipped past Tuesday, the campaign would never recover from.

**Hard rules.**

1. **Every cell names something.** Not "reputational risk" - "`<Subject>`-mental-fitness frame consolidating into `<RivalCamp>` doctrine".
2. **Every cell points down.** A reader who sees a row should be able to click-equivalent into the longread or the tables to see the evidence.
3. **Critical urgency is rare.** Bold or asterisk it only for items that meet both: (a) momentum is `dangerous` per the narratives, (b) the opportunity-side cell is empty or weak.

---

**Reference example (shape only).**

| Window | Risk → counter-move | Opportunity → claim |
| :----- | :------------------ | :------------------ |
| **<24h** | *Mental-fitness frame consolidates on TikTok (↑ what-you'd-miss #1)* → ship the 45s on-camera video before 09:00 | `<Rival2>` `<Event>` is fading uncollected (↓ narratives) → quote-card by 19:00 |
| **<72h** | `<RivalCamp>` cadence doubles on character axis (↓ narratives) → reframe as `<panic>` offensive | `<TopicA>` policy positioning emerging at 1.1M reach (↓ narratives) → start a 1-per-day cadence |
| **this week** | `<Ally_outlet>` silence becomes permanent (↑ what-you'd-miss #2) → private editor call | `<Subject>` consolidation among allies trending +27 pts (↓ SoV) → ship the joint statement |
| **this month** | Reach floor on TikTok sustained at −10pt anti-skew (↓ platform) → recruit two creator surrogates | `<Wing>` realignment opportunity if `<Rival2>` falters → pre-position the framing memo |

**Closing read.** The <24h row is load-bearing - the asymmetry between an active critical risk and a fading-but-claimable opportunity defines Monday's posture. Message capacity splits 60/40: counter-frame the character attack first, claim the `<Rival2>` opening second. The one thing that cannot slip past Tuesday is the `<Ally_outlet>` call - once the silence becomes a pattern, no public move recovers it.
"""


# ─── 3 MOVES ────────────────────────────────────────────────────────────────

MOVES_INTRO_MD = """<a id="sec-moves"></a>
## The moves

**Agent instructions for the whole moves block.** Up to three operational plays. Each lives in its own sub-widget. The point of this section is to be **shippable** - a campaign manager should be able to copy the content directly into a publishing tool without rewriting it.

**One strong move beats three padded moves.** If fewer than three plays are worth shipping this week, REMOVE the unused widget(s) via `update_dashboard(layout_id, removals=[...])`. Surviving siblings keep their numbers - Move 3 stays Move 3 even if Move 2 was dropped. Do NOT pad with generic moves. *"Increase engagement on TikTok"* is a fail.

**Rank the moves by urgency × asymmetric upside** - Move 1 is the Monday-morning play.

Each Move widget below must contain ALL of:

1. **One-line headline like an order.** *"Ship the character-counter video before Monday 09:00."*
2. **Defensive / Offensive tag.**
3. **Anchor.** Cite which Battle-Map cell and which What-you'd-miss finding this move addresses.
4. **Actual sample copy.** This is the new mandate: write the exact tweet thread / TikTok caption / quote-card text the campaign should post. In the data's dominant language. Quote it as a code block so it survives copy-paste.
5. **Execution plan - calendar.** `Day | Time | Channel | Format | Account` table.
6. **Amplification targets.** 3-5 named handles with one-line "why this account".
7. **Success KPI.** A specific reach / sentiment / ratio threshold AND a time window.

A move with sample copy that reads as a placeholder ("`<insert message here>`") is a fail.
"""


MOVE_X_MD_TEMPLATE = f"""<a id="sec-move-{{n}}"></a>
### Move {{n}} - `<one-line order headline>`

{VOICE}

**Type:** `<Defensive | Offensive>`

**Agent instructions.** Expand Battle-Map row `<window>` into a fully shippable operational plan for Move {{n}}. If fewer than {{n}} plays are worth writing, REMOVE this widget - do NOT fill with placeholder content.

**Required content (every block - non-negotiable).**

- **Anchor.** "Addresses Battle-Map `<window>` `<column>` cell · supports What-you'd-miss finding #`<k>`."
- **Sample copy (mandatory).** The actual content to post. Format as one or more fenced code blocks so it copy-pastes cleanly. Match the data's dominant language. Length matches the channel (tweet ~280 chars; TikTok caption + hook in voice-over; quote-card ≤ 60 words).
- **Execution calendar (table).** `Day | Time | Channel | Format | Account`.
- **Amplification targets (table).** `Handle | Followers | Why this account | Confirmed-or-cold`.
- **Success KPI.** Specific threshold + time window.

**Forbidden.** Generic copy, `<TBD>` placeholders, sample-handles labeled `@ally1`, vague "evening" / "morning" time windows (use a 30-minute window), KPIs without numbers ("more engagement").

---

**Reference example.**

**Type:** Defensive

**Anchor.** Addresses Battle-Map `<24h` Risk cell (mental-fitness frame consolidates on TikTok) · supports What-you'd-miss finding #1 (`<Rival1>` is over-amplified, not winning).

**Sample copy.**

X - text thread (4 posts):

```
1/  שלוש טענות, שלוש תשובות. נתחיל. (1/4)

2/  הטענה: "<paraphrased attack #1>". העובדה: <verifiable fact + 1 link>.

3/  הטענה: "<paraphrased attack #2>". העובדה: <fact + link>.

4/  הטענה: "<paraphrased attack #3>". העובדה: <fact + link>. מי שמפיץ את הקליפ הזה רוצה שתסתכל לכאן, כדי שלא תסתכל ל-<TopicA>.
```

TikTok - 45-second on-camera, no studio set, vertical, raw:

```
Hook (0-3s): "ראיתם את הקליפ. עכשיו תראו את העובדות."
Beat (3-25s): three numbered counter-points, on-screen captions, no music.
Close (25-45s): "<Subject>'s direct ask to viewers" - one specific action, link in bio.
```

**Execution calendar.**

| Day | Time | Channel | Format | Account |
| :-- | :--- | :------ | :----- | :------ |
| Mon | 08:00–08:30 | X | text thread | @subject_main |
| Mon | 09:00–09:30 | TikTok | 45s on-camera | @subject_tiktok |
| Mon | 19:00–19:30 | X + TikTok | quote-card image | @subject_movement + 4 ally accounts |

**Amplification targets.**

| Handle | Followers | Why this account | Confirmed / Cold |
| :----- | :-------- | :--------------- | :--------------- |
| @ally1 | 3.2M | Center-`<wing>`, prior alignment ratio 0.81 | Confirmed |
| @ally2 | 1.4M | Military credibility, reservist base | Cold - pitch by 07:00 |
| @ally3 | 890K | Crisis-comms audience, fast amplification | Confirmed |
| @ally_outlet | 1.1M | Mainstream outlet, content-paywall pickup | Cold - editor call |

**Success KPI.** Cumulative reach ≥ 600K within 72h (2× the original 302K attack root). Sentiment ratio on the mental-fitness narrative shifts from 1:5 to ≥ 1:2 within 48h.
"""


# ─── THE LONGREAD ────────────────────────────────────────────────────────────

LONGREAD_MD = f"""<a id="sec-longread"></a>
## The longread

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** A single piece of writing. **1,500–2,000 words of substance.** This is the one section in the report where the agent is being read as a writer, not as a section-filler. A reader who only reads the longread should walk away knowing what happened, why, what is going to happen next, and what to do about it.

**Mandatory structure - five parts, in this order, NOT marked by sub-headings except where noted. The writing carries the structure.**

1. **The thesis paragraph** (90–140 words). Restates the thesis sentence from the thesis card in EXPANDED form - not a paraphrase. Names the actors, the narratives, the platforms, the window. Lays out the argument the piece will make in this order: *what is true · why it is true · why it matters · what cannot be ignored.* Opens with a load-bearing first sentence; closes with the question the rest of the piece will answer.

2. **The setup paragraph** (120–180 words). Where this period sits in the longer campaign arc - early / mid / late. What was true going in (reference the period-delta numbers from the thesis card; do not re-table them). One verbatim quote from a prior-period post is allowed if it materially anchors the setup. Closes with the inflection that broke the prior trajectory.

3. **Three evidence beats** (250–350 words EACH - the bulk of the piece). Each beat develops ONE claim and proves it. Required content per beat:
   - **Topic sentence** that names the claim outright (not a question, not a tease).
   - **At least one specific post cited** with handle + reach + link (markdown `[view](post_url)`).
   - **At least one TVF-derived number** (sov_views, positive_pct, signal_score, daily reach, net_sentiment) pasted verbatim.
   - **One verbatim line of post text** in the original language, italicized, ≤ 25 words, with attribution (handle + date).
   - **A "but" / "however" / "the wrinkle is" sentence** that develops the claim - straight-line beats are weak beats.
   - **Closing sentence** that hands off to the next beat or to the counter-argument.

   The three beats COLLECTIVELY must reference findings from at least 6 of the supporting tables (narratives, SoV, daily, top posts, platform, stance, emotion).

4. **The counter-argument paragraph** (100–150 words). Opens with: *"The case against this reading is…"* (or the equivalent in the data's language). Lays out the strongest version of the opposing argument - not a strawman. Then deals with it. If the agent cannot find a real counter-argument, the thesis is too soft and must be rewritten. A counter-argument paragraph that ends *"…but ultimately the data favors the thesis"* without saying HOW the data favors it is a fail.

5. **The kicker** (40–80 words). One short final paragraph that lands the argument. The widget's only sub-heading goes here: a single H3 (`### `) named **`### The week in one line.`** followed by ONE bolded sentence the reader could screenshot and quote as the takeaway. **The bolded sentence must be different from the thesis card's thesis sentence** - it is the consequence of the thesis after the longread has argued it.

**Prose-feature constraints (concrete - these are what the writing must look like).**

- **No bullet points or numbered lists in this widget**, except inline-list callouts inside prose: *"the three handles - @one, @two, @three - together produced 71% of the day's reach."* Never `1. 2. 3.` on separate lines.
- **No tables in this widget.** Numbers live inline.
- **No sub-headings except the single H3 kicker.** The five parts blend prose-to-prose; the reader feels the structure without seeing it.
- **Paragraph cadence.** Aim for 90–180 words per paragraph. A paragraph under 50 words is a stub; one over 220 is a wall.
- **Sentence variety.** At least one short sentence (under 12 words) every 3–5 paragraphs. Hard work happens in short sentences.
- **No "we / our analysis" framing.** Avoid first-person plural. Write as if the analysis is the report, not a reporter doing the report.
- **No section-brief phrases.** Forbidden: *"In this section we…"*, *"Below we examine…"*, *"Moving on…"*, *"As shown above…"*, *"It is worth noting…"*. Write as if there are no sections.
- **Quotes in the original language.** When the data is Hebrew, quoted post text stays Hebrew (italicized). When English, English.

**Anti-redundancy rule (load-bearing).** The longread argues the THESIS in depth. *What-you'd-miss* surfaces findings the thesis does not cover. The Battle Map operationalizes both. The longread's three evidence beats may overlap with What-you'd-miss findings, but the kicker must NOT restate the thesis sentence verbatim - it is the *consequence* of the argument, expressed differently.

**Event-date verification (load-bearing).** When the longread names a specific event (party launch, merger, scandal, appointment, interview airing), the event's actual verified date - from independent web grounding - goes in the prose, not the corpus post date. Anniversary, recap, and commemorative posts come weeks after the event. The verifying news URL belongs in App-A.

**Pre-publish checklist (run mentally before patching this widget).**

- [ ] Word count is 1,500–2,000. Count it.
- [ ] Thesis paragraph (90–140 w), setup (120–180), three beats (250–350 each), counter-argument (100–150), kicker (40–80).
- [ ] Only ONE H3 (the kicker). No other sub-headings.
- [ ] Zero bullet points, zero tables.
- [ ] At least 3 cited posts with markdown links to real `post_url`s.
- [ ] At least 6 distinct supporting-table findings referenced.
- [ ] At least one verbatim post quote per beat, in the original language, italicized.
- [ ] Counter-argument paragraph exists and is not a strawman.
- [ ] Kicker bolded sentence is different from the thesis card's thesis sentence.

**Forbidden in this widget.** Methodology vocabulary (TVF, topic_metrics, signal_score, embedding, scope_posts, JSON_EXTRACT, "Entity Match", "UNION", "dedupe"). Diagnostic-process language ("*Cross-check:*", "*בדיקת הצלבה:*"). Final "in conclusion" paragraph. Hedging adverbs (*appears*, *seems*, *somewhat*, *could be argued*, *broadly*).

---

**Reference example (skeleton - write fresh for the current period; do NOT propagate these strings).**

[Thesis paragraph, ~120 words.] `<Rival1>` ended the week with a 36% share of voice and a sentiment ratio of one supporter for every two-and-a-half attackers - the worst pro/anti ratio in the field. The reading on the surface is that he won the volume war and lost the conversion war. The reading underneath is that he won neither: his weekly reach is a single 1.1M-view TikTok clip, posted at 21:14 on `<DATE>`, and the rest of his amplification is a thin layer of secondary accounts re-cutting that one piece of content. Strip the clip and `<Rival1>`'s reach falls below `<Subject>`'s. The campaign's question for Monday is whether to respond at all - and the data argues against responding.

[Setup paragraph, ~150 words.] Going into the period, the prior week had `<Rival1>` at 33.8% SoV and `<Subject>` at 22.6%; the gap was closing. Foreign-press coverage of the `<Subject>+<Ally>` merger was bleeding into Hebrew-language repackaging on TikTok, and the response cluster had momentum. The merger itself happened on 2026-04-22 - verified via *[`<Outlet>`](https://news.example/article)* - meaning the corpus posts about it on the early days of this period are reinforcement, not announcement. Then came `<Sunday>`'s root post - *"<verbatim quote, ≤25 words, in original language>"* - and the gap stopped closing.

[Beat 1, ~300 words.] *The `<Rival1>` reach lead is one-clip-thin.* The clip that built the lead is [a 1.1M-view TikTok](https://www.tiktok.com/...) from @rival1_main posted at 21:14 on `<DATE>` - 43% of his weekly reach in one post. The `topic_metrics` row for the mental-fitness narrative reports `signal_score` `<S>` and `positive_pct` 6%; the `sov_views` row for `<Rival1>` is 36.0%. The cleanest read of those two numbers together is that the lead is concentrated, not durable. The wrinkle is that the clip's secondary amplification (43 re-cuts in 36 hours) suggests the underlying network is intact even if the primary post fades. The campaign should not confuse the volatility of the lead post with the volatility of the network behind it. *…continues for ~120 more words…*

[Beat 2, ~300 words. Similar shape.]

[Beat 3, ~300 words. Similar shape.]

[Counter-argument paragraph, ~130 words.] The case against this reading is that mental-fitness attack cycles do not require organic conversion to do damage - they require repetition and emotional anchoring, both of which a brittle-but-loud post supplies. On that view, the response cluster's 6× under-amplification is the load-bearing fact, not the clip's brittleness; the campaign cannot afford to wait the clip out. The strongest case against the thesis is therefore that *Rival1*'s mechanic does not need to "win" to win. The reply is that the data shows the conversion mechanic IS where the damage lives: TikTok carries the anti-skew, X carries the policy frame; the campaign already has a TikTok answer it has not shipped. The thesis stands - the move is to ship the answer.

### The week in one line.

**The campaign is not behind on share of voice - it is behind on the one piece of content it has already drafted.**
"""


# ─── THE NUMBERS (supporting evidence) ──────────────────────────────────────

NUMBERS_DIVIDER_MD = """---

# The numbers

*The blocks below are the evidence base. They support the thesis, the contrarian findings, the battle map, the moves, and the longread. Each block is short - tables and one or two paragraphs. Read these when you want to verify a claim or pull a number for a memo.*

---
"""


NARRATIVES_MD = f"""<a id="sec-narratives"></a>
## Narratives in play

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** A compact table - top **6-10 narrative clusters** - and **one short paragraph** under it interpreting the field. NOT a re-write of the longread. Tables are evidence; the analysis is upstream.

**Data source.** Call `list_topics` (queries `topic_metrics(@agent_id)` internally). Rank by `signal_score` DESC. Use these columns verbatim - do not recompute:

- `topic_name`, `topic_summary`, `post_count`, `total_views`,
- `positive_pct`, `negative_pct`, `neutral_pct`,
- `signal_score`, `sample_posts`.

**Table schema (exactly this).**

| Narrative | Posts | Reach | Sentiment (P/N/M) | Lead voices | Momentum | Stance to subject |

- **Narrative** = `topic_name` + 1-line `topic_summary` paraphrase in the data's language.
- **Posts / Reach** = pasted verbatim.
- **Sentiment (P/N/M)** = `<positive_pct>% / <negative_pct>% / <neutral_pct>%` (paste verbatim).
- **Lead voices** = top 2–3 channel handles from `sample_posts`.
- **Momentum** = `emerging` / `sustained` / `fading` / `dangerous`. Rule:
  - `dangerous` = negative_pct > 60% AND signal_score in top quartile
  - `emerging` = first appearance OR signal_score >2× prior
  - `fading` = post_count last 3 days < 25% of cluster total
  - `sustained` = anything else
- **Stance to subject** = `attacking` / `defending` / `neutral` / `mobilizing` - from a quick scan of `sample_posts` AI summaries.

Below the table, **one short paragraph (50–90 words)** naming: which narrative carries the period (signal_score #1), which is the load-bearing risk for the subject (`dangerous` momentum), which is the load-bearing opportunity (`emerging` momentum), and one cross-platform divergence worth flagging.

Reference the word-cloud widget once.

**Forbidden.** Methodology terms (`topic_metrics`, `signal_score` as a literal column-name, `embedding`, `list_topics`).

---

**Reference example (shape only).**

| Narrative | Posts | Reach | Sentiment (P/N/M) | Lead voices | Momentum | Stance to subject |
| :-------- | ----: | ----: | :---------------: | :---------- | :------- | :---------------- |
| `<Subject>` mental fitness - character attack | 78 | 690K | 6% / 81% / 13% | @rival_outlet, @rival1, @anon_clip | **dangerous** | attacking |
| Coalition launch + merger | 142 | 1.2M | 64% / 14% / 22% | @subject, @ally1 | sustained | defending |
| `<Rival2>` `<Event>` opening | 66 | 686K | 12% / 70% / 18% | @news1, @news2 | fading | neutral |
| `<TopicA>` policy positioning | 51 | 1.1M | 58% / 21% / 21% | @subject, @subject_movement | emerging | mobilizing |

The week's load-bearing narrative is the mental-fitness frame (`dangerous`, 690K, 81% negative) carried by three high-reach amplifying accounts and crossing into TikTok where the subject is structurally under-amplified. The `<Rival2>` `<Event>` cluster is fading uncollected (686K organic anger, no claim-of-frame). The `<TopicA>` positioning is the cleanest emerging opportunity. Cross-platform divergence: the launch reads as strategy on X and as personality on TikTok.
"""


SOV_MD = f"""<a id="sec-sov"></a>
## Share of voice

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** One table - every material actor, ranked by reach - plus a math footnote and one short interpretation paragraph.

**Discovery (MANDATORY before calling the TVF).** Sample what is actually in the `entities` array:

```sql
SELECT LOWER(TRIM(entity)) AS entity_norm, COUNT(*) AS c
FROM social_listening.scope_posts(@agent_id), UNNEST(entities) AS entity
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY entity_norm
ORDER BY c DESC
LIMIT 100
```

Group the top entities into canonical clusters using ONLY strings that appeared in the result. Surnames, nicknames, transliterations, party names - include every variant seen. Match is exact-equality after `LOWER(TRIM())`. Substring matching does not work.

**Data source.** Call `entity_metrics(@agent_id, @groups, @period_start, @period_end, NULL)` once with every material actor. Use these columns verbatim - do not recompute:

- `entity` (NOT `canonical`),
- `post_count`, `total_reach`,
- `sov_views` (corpus-grounded share - paste as percent; do NOT re-normalize by summing the table's reach column),
- `pos_mentions`, `neg_mentions`,
- `net_sentiment`,
- `top_content_type`, `top_emotion`.

**Table schema (exactly this).**

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Trend | Posture |

- **SoV %** = `sov_views` from the TVF row.
- **Trend** glyph + word from `net_sentiment` thresholds - uniform across rows:
  - `▲ <positive-word>` when `net_sentiment > +0.10`
  - `▬ <mixed-word>` when `−0.10 ≤ net_sentiment ≤ +0.10`
  - `▼ <negative-word>` when `net_sentiment < −0.10`
  Localize: Hebrew (חיובי / מעורב / שלילי) · English (positive / mixed / negative).
- **Posture** = `leading` / `defending` / `attacking` / `flanking` / `silent` / `over-amplified`.

**Math footnote (mandatory - one line below the table).**

> *Corpus reach: `<N>` · Actor-reach sum: `<M>` · Multiplier: `<M÷N>×` · Average mentions per post: `<avg>`. Explains the >100% row sum.*

Compute `<avg>` from:
```sql
SELECT ROUND(AVG(ARRAY_LENGTH(entities)), 2) AS avg_entities_per_post
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND ARRAY_LENGTH(entities) > 0
```

Below the table and footnote, **one short paragraph (50–80 words)** naming the volume-vs-reach leader, the worst pro/anti ratio, who is silent, who is over-amplified, who has the cleanest profile.

Reference the SoV stacked-bar widget once.

**Forbidden.** No `entity_metrics`, no "Entity Match", no UNION-of-signals methodology language in this widget.
"""


DAILY_TIMING_MD = f"""<a id="sec-daily"></a>
## Daily timing & inflection

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** A compact day-by-day table for the full period + a short inflection paragraph.

**Data source.** Call `daily_metrics(@agent_id, @period_start, @period_end, @timezone)` once. From each row use: `date`, `posts`, `views`, `positive_pct`, `negative_pct`, `top_emotion`, `top_entities`, `top_themes`, `top_channels`.

**Table schema.**

| Date | Posts | Reach | Pro / Anti | Top emotion | Daily inflection (one line) |

Every day in the period appears, even sparse days. Mark blanks `-` rather than dropping the row. `daily_metrics` already includes sparse days - the agent does NOT generate the date series.

After the table, **two inflection paragraphs (60–100 words each)** - the 2 days that changed the shape of the period. Each cites specific posts (date, time, platform, account, views - pull from `top_posts` JSON in `window_metrics` or query `scope_posts` for the day).

**Two non-negotiable rules.**

1. **Event-date verification.** When a daily inflection names an event ("merger announced", "interview airs"), use the event's verified actual date - see the longread's date-verification rule. A post on day Y about a week-ago event is reinforcement, not the inflection itself.

2. **Plausibility cross-check (silent, MANDATORY).** For every claim of the form *"X drove the spike on day Y"*, run ONE query before writing it:

```sql
SELECT platform, COUNT(*) AS posts, SUM(views) AS reach
FROM social_listening.scope_posts(@agent_id)
WHERE DATE(posted_at) = DATE '<Y>'
GROUP BY platform
ORDER BY reach DESC
```

If X's share of day Y's reach is < 30%, the claim is wrong - rewrite. **The cross-check happens silently.** Do not write the word "cross-check" / "*בדיקת הצלבה*" in the prose. State the operational result.

Reference the daily-volume line chart on the dashboard once.
"""


TOP_POSTS_MD = f"""<a id="sec-top-posts"></a>
## Top posts - pro side & anti side

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Two compact tables, side-by-side conceptually. Use the `top_posts` JSON in `window_metrics` as the primary source; fall back to `scope_posts` if the agent needs sentiment-specific top-N.

**Top reach (pro-side).** 5 rows.

| Date | Platform | Account | Views | Likes | Link | What was said | Why it landed |

**Top reach (anti-subject).** 5 rows.

| Date | Platform | Account | Views | Likes | Link | What was said | Counter-move |

- Quoted message in original language, 1 line, italicized.
- `Link` is `[view](post_url)` - actual DB `post_url`. Missing URL = `-` and footnote the missing-URL count.
- `Why it landed` / `Counter-move` is one sharp line.

**Fallback SQL (use only if `top_posts` JSON does not give sentiment-specific top-N):**

```sql
-- Top reach by sentiment
SELECT post_id, channel_handle, platform, content_type, posted_at, views, likes, content, post_url, ai_summary
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND sentiment = '<positive | negative>'
ORDER BY views DESC LIMIT 5
```
"""


PLATFORM_CHANNEL_MD = f"""<a id="sec-platform"></a>
## Platform & channel

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Two short sub-blocks (`###` headers).

**Platform asymmetry.** One table.

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

| Platform | Posts | Post share % | Reach share % | Pro % | Anti % | Audience implication |

One short paragraph (40–70 words) below the table naming the asymmetry: which platform punches above its post-share, where sentiment is most hostile, where the subject is structurally under-amplified.

If the corpus is single-platform, REMOVE this sub-section.

Reference the Sentiment Mix doughnut + Platform Mix bar (side-by-side widgets below).

**Top channels / amplifiers.** The Top Channels table widget on the dashboard carries the data - **interpret, don't re-table**. Two short paragraphs:

1. **Who is amplifying the subject.** Top 3–5 channels carrying pro-subject content. Named handles. Identify official / media / UGC / influencer classifications via `channel_type`.

2. **Missed amplification.** 2–4 adjacent accounts that consistently amplified in the prior 60 days but did NOT this period. Use:

```sql
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

List 3–5 handles + the post they could have amplified but didn't. This is the upstream input for the Moves' amplification-target tables.

Reference the Top Channels table widget once.
"""


STANCE_EMOTION_MD = f"""<a id="sec-stance"></a>
## Stance & emotion

{VOICE}

{BODY_SKELETON}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Two short sub-blocks (`###` headers). Either is removable if the data is genuinely missing - confident silence beats false synthesis.

**Stance distribution.** Surface the most informative `custom_fields.<field>` distribution given the user's framing (typically a candidate-stance field). Discover by sampling, then query the distribution; then **translate raw snake_case keys into human phrases in the data's language**. Raw `pro_bibi` / `anti_bennett` keys never appear in customer-facing cells.

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

| Stance | Posts | Avg reach / post | Sentiment (Pro / Anti) |

Below the table - one short paragraph (40–70 words) interpreting the gap between organic supporters and amplification-machine posts.

If the agent has no `custom_fields`, REMOVE this sub-section.

**Emotion correlation on subject's own content.** When `emotion` enrichment is available, count which emotions on the SUBJECT'S OWN posts correlate with reach. Tells the campaign which register works.

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

One sentence below stating the dominant high-performing emotion + recommendation for tone next period.

If `emotion` non-null coverage on the subject's posts is < 50%, REMOVE this sub-section.
"""


APPENDIX_MD = f"""<a id="sec-app"></a>
## Methodology, data quality & external grounding

{VOICE}

**Agent instructions.** ONE appendix in two parts (`###` sub-headers). Do not split into two widgets.

---

### A. External grounding (independent sources only)

**Strict rule - corpus platforms are FORBIDDEN here.** No `x.com`, `twitter.com`, `tiktok.com`, `youtube.com`, `instagram.com`, `facebook.com` links. The corpus posts those platforms produced are the data, not the grounding. External grounding means independent journalism, polls, market research, third-party reports, official statements off-platform.

**Minimum: ≥3 distinct external hostnames, ≥5 total links.** If web grounding cannot produce ≥3 distinct news/poll/report domains, the report is not actually grounded - re-run web grounding before publishing.

- Each entry: one-line summary, markdown link `[label](url)`, and the specific section / claim it grounds.
- Group by type when there are enough (Polls / Press / Market / Official / Regulatory).
- **Run web grounding for every event-driven claim in the longread** - the article you used to date the event belongs here.
- A source that doesn't connect to a specific body finding doesn't earn its place.

**SERP and placeholder URLs rejected.** `google.com/search?q=…`, `bing.com/search?q=…`, `…/sample-url`, `example.com`, etc. are forbidden - `verify_dashboard` rejects them.

---

### B. Methodology, data sources & data quality

**Agent instructions.** Plain operational language. Describe what was done, not just which functions were called. Internal tool names (`topic_metrics`, `entity_metrics`, `window_metrics`, `daily_metrics`, `scope_posts`, `list_topics`, `execute_sql`) MAY appear here - but each paired with a plain-language explanation.

Cover:

- **Data scope** - agent ID, source-collection count.
- **Period** - exact start / end timestamps + timezone, plus the prior period used for the delta.
- **Corpus** - total posts (raw / dedup), platform mix, language mix.
- **Statistics layer** - name the TVFs (`topic_metrics` for narratives, `entity_metrics` for SoV, `window_metrics` for thesis-card + top-posts, `daily_metrics` for daily timing). One plain line per TVF on what it returns. *This is the only section in the entire report where the TVF names are allowed.*
- **Classification** - how sentiment / stance / emotion / themes were derived.
- **External sources consulted** - count + brief description with link back to Part A.
- **Data-quality scoreboard** (REQUIRED) - per-field non-null coverage:

| Field | Non-null % | Notes |
| :---- | ---------: | :---- |
| sentiment | 98.4% | Standard 3-class |
| emotion | 92.1% | 7 categories |
| entities | 76.3% | Exact-name extraction |
| custom_fields.<field1> | 88.7% | Stance enrichment |
| themes | 95.5% | |

Query template:
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

- **Known data gaps** - platforms missing, periods sparse, voices absent, enrichment fields not populated. Be specific.
- **Sub-section removals** - which optional widgets were dropped this run and why (single-platform corpus, no custom_fields, emotion coverage <50%, unused Move slots, contrarian-finding count below three).
- **Self-report block** - at the end of App-B include:
  - `Longread final word count: <N>` (must fall in 1,500–2,000 - flag if outside band).
  - `Contrarian findings written: <N> of 3` (with one-line rationale if fewer than three).
  - `Moves written: <N> of 3` (with one-line rationale if fewer than three).
  - `Prior-period delta: rendered | omitted (sparse)` - and the prior-period post count if omitted.
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
        _text("vchdr0000a", HEADER_MD, h=3),
        # 4 KPI cards
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        # HERO
        _text("vcsec00the", THESIS_MD, h=14),
        # Daily-volume chart pulled up here so the thesis card's "Look at:"
        # callout has a target directly below the thesis.
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        # WOW
        _text("vcsec01mis", WHAT_YOUD_MISS_MD, h=22),
        _text("vcsec02bat", BATTLE_MAP_MD, h=20),
        _text("vcsec03int", MOVES_INTRO_MD, h=8),
        _text("vcsec03m01", MOVE_X_MD_TEMPLATE.format(n=1), h=22),
        _text("vcsec03m02", MOVE_X_MD_TEMPLATE.format(n=2), h=22),
        _text("vcsec03m03", MOVE_X_MD_TEMPLATE.format(n=3), h=22),
        # THE LONGREAD
        _text("vcsec04lng", LONGREAD_MD, h=42),
        # numbers divider
        _text("vcdivnum01", NUMBERS_DIVIDER_MD, h=4),
        # supporting tables
        _text("vcsec05nar", NARRATIVES_MD, h=22),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("vcsec06sov", SOV_MD, h=24),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("vcsec07day", DAILY_TIMING_MD, h=22),
        _text("vcsec08top", TOP_POSTS_MD, h=18),
        _text("vcsec09plt", PLATFORM_CHANNEL_MD, h=22),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("vcsec10stn", STANCE_EMOTION_MD, h=22),
        # CLOSE
        _text("vcsecapp00", APPENDIX_MD, h=34),
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
    title = "The Brief - Intelligence Report (Template version C)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"version C layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN - not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(VERSION_C_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": VERSION_C_TEMPLATE_ID,
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
    db.collection("explorer_layouts").document(VERSION_C_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote version C template: dashboard_layouts/{VERSION_C_TEMPLATE_ID}")
    print(f"Wrote version C explorer entry: explorer_layouts/{VERSION_C_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
