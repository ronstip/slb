"""Build the v6 weekly competitive brand report template.

Changes from v5 (response to the v5-report audit):

  §2  Metadata & contextual frame
      - Adds a "Verified events of the period" block REQUIRED before the
        contextual-frame paragraph. Each named event (party launch, merger,
        scandal, appointment) carries a date verified via web grounding -
        NOT the date of a corpus post mentioning the event. Corpus posts
        about events typically come weeks after the event itself (the
        Bennett-Lapid merger was treated as 12.05 in v5 because the agent
        confused a commemorative post with the event date).

  §5  Share of Voice
      - Indicator column renamed "Tone" → "Trend" (Hebrew: מגמה). Values
        are glyph + single descriptive word, not a glyph alone:
          ▲ חיובי   (positive)
          ▬ מעורב   (mixed)
          ▼ שלילי   (negative)
      - Overlap footnote becomes a concrete-math line, not a vague %:
        "Corpus reach: <N>. Row sum: <M>. Multiplier: <M/N>. Average
         actors per post: <avg_entities>." Forces real reconciliation,
         not hand-waving.
      - Methodology line ("data UNION of entity-match + stance signals")
        REMOVED from the body - it belongs in §App-B if anywhere.

  §7  Chronology
      - Inflection-point cross-checks happen behind the scenes; the
        narrative sentence STATES THE RESULT operationally without
        flagging "*Cross-check:*" to the reader. The customer sees the
        finding, not the diagnostic.
      - Each named event in a row must trace to a verified event date
        (from §2's verified events block), not the post date.
      - §7b cuts must cover ≥80% of total reach. If the named cuts sum
        to less, add a final "Other / residual" row.

  §8c Stance distribution
      - Reconciliation note rewritten to be operational, not diagnostic.

  §9  Narratives
      - When a cluster's reach is materially smaller than a §7b slice
        covering the same content, add a one-line acknowledgement.

  §App External context & methodology
      - §App-A is renamed "External grounding (independent sources only)"
        and forbids linking to corpus platforms (x.com, twitter.com,
        tiktok.com, youtube.com, instagram.com, facebook.com). At least
        3 distinct external hostnames required.
      - §App-B methodology stripped of internal tool slugs - describe
        what was done in plain Hebrew/operational terms, not by naming
        `entity_metrics` / `scope_posts` / `execute_sql` etc.

  Overall tone hardening
      - Internal terminology - `Entity Match`, `Candidate Stance`,
        `UNION`, `dedupe`, tool slugs - is forbidden in §2 through §14.
        Methodology lives in §App-B only.

All other briefs imported from v3 verbatim.

Usage:
    uv run python scripts/build_dashboard_template_v6.py [--dry-run]
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
    VOICE, BODY_SKELETON,
    HEADER_MD, SEC_3_MD, SEC_4_MD,
    SEC_6_MD, SEC_8A_MD, SEC_8B_MD, SEC_8D_MD,
    SEC_10_MD, SEC_11_MD, SEC_12_MD, SEC_13_MD,
    SEC_14_X_MD_TEMPLATE,
    _chart_widgets,
)
from scripts.build_dashboard_template_v5 import (  # noqa: E402
    SEC_14_INTRO_MD,
)
from api.deps import get_fs  # noqa: E402

V6_TEMPLATE_ID = "e6a2c9f4b5d72e3c6b8d5a9e1c7f0b53"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Briefs that differ from v3/v5 ──────────────────────────────────────────

SEC_2_MD = f"""## 2. Metadata & contextual frame

{VOICE}

**Agent instructions.** Three blocks, in this order: (1) quantitative spec, (2) verified events of the period, (3) contextual frame. Numbers are real or `n/a` - never a hedge. Localize field labels into the data's language; preserve order.

**Block 1 - Quantitative spec.**
```
- Period: <YYYY-MM-DD> → <YYYY-MM-DD>
- Total posts: <raw> raw / <dedup> after dedup
- Platforms: <Platform1> <X.X%> · <Platform2> <X.X%> · …
- Languages: <Lang1> <X.X%> · …
- Reach (total views): <N>
- Engagement (likes + comments + shares): <N>
- Source collections: <name or count>
- Primary entities tracked: <Entity1>, <Entity2>, …
```

**Block 2 - Verified events of the period (load-bearing).** A compact list of the named events that shaped the period - party launches, mergers, scandals, appointments, major speeches. Each event line states the VERIFIED ACTUAL DATE - confirmed against an independent news source via web grounding - NOT the date of a corpus post mentioning it.

| Date | Event | Source |
| :--- | :---- | :----- |

**Why this matters.** A corpus post on day Y about event X does NOT mean X happened on Y. Anniversary/commemorative/recap posts are common in political corpora - they reference an event from weeks earlier. Conflating post-date with event-date is the single most embarrassing failure mode of this report. If you cannot find an external news source dating the event, mark the date as `~MM` (approximate month) and footnote the uncertainty - do NOT invent precision.

**Block 3 - Contextual frame.** 2–3 lines: where this period sits in the longer campaign arc (early / mid / late) and what happened in the world during it that matters. Positioning, not background. Reference the events from Block 2 - do NOT introduce new events here.

**Internal terminology - forbidden in this widget.** No `entity_metrics`, no "Entity Match", no "Candidate Stance", no `UNION`, no tool names. The customer reads this. Methodology lives in §App-B.

---

**Reference example (shape only).**

```
- Period: 2026-MM-DD → 2026-MM-DD
- Total posts: 2,672 raw / 2,457 after dedup
- Platforms: Twitter 71% · TikTok 29%
- Languages: <Lang> 96% · <Lang2> 3% · <Lang3> 1%
- Reach (total views): 22.6M
- Engagement: 1.42M
- Source collections: 19 collections
- Primary entities tracked: <Subject>, <Rival1>, <Rival2>, …
```

**Verified events of the period.**

| Date       | Event                                 | Source                                 |
| :--------- | :------------------------------------ | :------------------------------------- |
| 2026-04-22 | `<Subject>` + `<Ally>` merger announced | [`<Outlet>` (2026-04-22)](https://news.example/article-id) |
| 2026-05-08 | `<Rival>` defamation suit filed       | [`<Outlet2>` (2026-05-08)](https://news2.example/article)  |
| 2026-05-10 | `<Subject>` interview airs on `<Show>` | [`<Outlet3>` (2026-05-10)](https://news3.example/article)  |

**Contextual frame.** Week 3 post-merger. Mid-campaign. The defamation suit anchors the period's narrative; the foreign-press interview gives the rival camp a global stage. The merger itself is two weeks old - posts referencing it now are reinforcement, not announcement.
"""


SEC_5_MD = f"""<a id="sec-5"></a>
## 5. Share of Voice & KPI dashboard

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Build one row per material actor. **Rank by reach.** Use this exact column schema (no extra columns, no dropped columns):

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Trend |

- **Posts**: count of in-scope posts mentioning the actor.
- **Reach**: sum of views.
- **SoV %**: copy `sov_views` from the `entity_metrics` row, formatted as a percent. **Do NOT re-normalize by summing the table's rows.** The TVF computes SoV against the corpus's full reach. If row SoVs sum to >100%, that is the expected overlap signal - see the math footnote below.
- **Sentiment (Pro / Anti)**: `<pro count> / <anti count>`.
- **Trend** (column header in Hebrew: **מגמה**): the actor's net tone - glyph + one descriptive word, from the TVF's `net_sentiment` field. Three values only:
  - `▲ חיובי`   when `net_sentiment > +0.10`
  - `▬ מעורב`   when `−0.10 ≤ net_sentiment ≤ +0.10`
  - `▼ שלילי`   when `net_sentiment < −0.10`
  Apply the threshold uniformly. Do not pick by impression. Localize the word into the data's language (Hebrew: חיובי / מעורב / שלילי; English: positive / mixed / negative).

**Math footnote (mandatory, exactly this shape - one line).** Below the table:

> *סך חשיפת הקורפוס: `<N>` · סכום החשיפה לשחקנים: `<M>` · מכפלה: `<M÷N>×` · ממוצע אזכורים לפוסט: `<avg>`. מסביר את סכום הנתחים החורג מ-100%.*

(English: *"Corpus reach: <N>. Actor-reach sum: <M>. Multiplier: <M/N>×. Average mentions per post: <avg>. Explains the >100% row sum."*)

Compute `<avg>` from:
```sql
SELECT ROUND(AVG(ARRAY_LENGTH(entities)), 2) AS avg_entities_per_post
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND ARRAY_LENGTH(entities) > 0
```

**No methodology in the body.** Do NOT write "data UNION of entity-match and stance signals" or any equivalent phrasing in the §5 widget. The deduplication and signal sources are implementation detail - they belong in §App-B if anywhere. The reader sees the rows and the math footnote; that's it.

**Before calling the TVF**, sample what's actually in `entities`:
```sql
SELECT LOWER(TRIM(entity)) AS entity_norm, COUNT(*) AS c
FROM social_listening.scope_posts(@agent_id), UNNEST(entities) AS entity
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY entity_norm
ORDER BY c DESC
LIMIT 100
```
Variants match by exact equality after `LOWER(TRIM())`. Result column is `entity` (not `canonical`).

Below the table and footnote, **1–2 paragraphs** of operational interpretation: volume vs. reach leaders, worst pro/anti ratio, who is silent, who is over-amplified. Table = what; paragraph = so what. Reference the stacked-bar chart widget once.

---

**Reference example (shape only).**

| Actor              | Posts | Reach     | SoV % | Sentiment (Pro / Anti) | Trend |
| :----------------- | :---: | :-------: | :---: | :--------------------: | :---: |
| `<Rival1>`         |  509  | 8,134,766 | 36.0% |        136 / 344       | ▼ שלילי |
| `<Subject>`        |  362  | 4,641,794 | 20.5% |         85 / 249       | ▼ שלילי |
| `<Rival2>`         |  266  | 2,167,018 |  9.6% |         46 / 204       | ▼ שלילי |
| `<Rival3>`         |  217  | 1,767,492 |  7.8% |         59 / 132       | ▬ מעורב |

*סך חשיפת הקורפוס: 22.6M · סכום החשיפה לשחקנים: 24.1M · מכפלה: 1.07× · ממוצע אזכורים לפוסט: 1.12. מסביר את סכום הנתחים החורג מ-100%.*

**Strategic insight.** `<Rival1>`'s reach lead rests on a single viral mechanic; the pro/anti ratio is the most negative in the field. `<Subject>` holds a clean #2 with a stable sentiment profile and a credible gap to #3. The four trailing actors together produce 20.7% - less than `<Subject>` alone.
"""


SEC_7_MD = f"""<a id="sec-7"></a>
## 7. Chronology - what shaped the week

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Three sub-sections. Sub-section headers use `###` (not `##`). Numbers and dates here are the highest-risk surface for errors - build every cell from a single query result, not memory.

**7a. Day-by-day table.** One row per day in the requested period - **every day, even if the data is sparse**. Sparse days are signal, not noise; mark them `-` rather than dropping the row.

| Date | Posts | Reach | Pro / Anti | Daily inflection (one line) |

Fill missing days by left-joining against a generated date series, OR by explicitly listing every day in the period and marking blanks as `-`.

**7b. Format / channel performance.** A compact table over the same period. Pick ONE cut: platform × `content_type` OR `channel_type`. Don't mix.

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |

**Coverage rule (load-bearing).** The named cuts must cover **≥80% of total reach** for the period. If the cuts you chose leave more than 20% uncategorized, add a final row `Other / residual` showing the remainder so the column sums clean. The customer must be able to add the column and get back to the §2 corpus reach.

**7c. Inflection points (load-bearing).** 2–3 days that **changed the shape of the period** and what drove them. Each inflection cites specific post(s) - date, time, platform, account, views - sourced from the data.

**Two non-negotiable rules:**

1. **Event-date verification.** When a row names an event ("merger announced", "interview airs", "appointment"), the event date MUST match the verified date in §2's "Verified events of the period" block - NOT the post date. A post on Day Y about an event from week-N-2 is a commemorative / reinforcement post; it does not move the inflection to Day Y. If a post-date and an event-date diverge, write the inflection around the event-date and treat the recent post as amplification.

2. **Plausibility cross-check.** For every claim of the form *"X drove the spike on Day Y"*, run ONE targeted query before writing it:

```sql
-- did <X> actually drive Day-Y reach?
SELECT platform, COUNT(*) AS posts, SUM(views) AS reach
FROM social_listening.scope_posts(@agent_id)
WHERE DATE(posted_at) = DATE '<Y>'
GROUP BY platform
ORDER BY reach DESC
```

If `<X>`'s share is below 30% of Day Y's reach, the claim is wrong - rewrite it. **The cross-check happens silently - DO NOT write the word "cross-check" or "*בדיקת הצלבה*" in the customer-facing prose.** State the result operationally: instead of *"בדיקת הצלבה: TikTok contributed 66% of the daily reach"*, write *"TikTok carried 66% of the day's reach, almost entirely from three @60minutes clips"*. The customer reads the finding, not the diagnostic.

Reference the daily-volume line chart on the dashboard once.

---

**Reference example.**

**7a. Day-by-day.**

| Date  | Posts | Reach | Pro / Anti | Daily inflection |
| :---- | ----: | ----: | :--------: | :--------------- |
| MM-DD |   391 |  4.1M |   95 / 130 | Counter-attack lands - 3 anti posts at 300K combined |
| MM-DD |   368 |  3.4M |   82 / 121 | Foreign-press interview airs (verified airdate, see §2) |
| MM-DD |    -  |   -   |     -      | (sparse - only N posts; cause: weekend / holiday) |

**7b. Format / channel performance.**

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |
| :--- | ----: | ----------: | ---------------: | ---------------: | :------- |
| X - official statements | 12 | 1.55M | 129K | 10.5% | Few posts, huge per-post weight |
| X - text commentary     | 482 | 2.58M | 5.4K |  17.5% | Workhorse format for argumentation |
| TikTok - opinion video  |  17 | 434K  | 25K  |   2.9% | Punches above its volume |
| X - image / quote-card  | 198 | 8.34M | 42K  |  56.5% | Where the period's reach concentrates |
| **Other / residual**    | 142 | 1.92M | 13.5K | 12.6% | UGC + small-handle replies |

*(Coverage: rows cover 100% of period reach.)*

**7c. Inflection points.**

- **MM-DD: counter-attack lands.** Three pro-`<RivalCamp>` posts ([302K](https://x.com/...), [180K](https://x.com/...), [110K](https://x.com/...)) carry the "<AttackLine>" frame on X - they account for 71% of the day's reach. `<Subject>`'s response (50K views) is 6× under-amplified.
- **MM-DD: foreign-press interview lands.** The actual interview aired on `<DATE-verified>` (see §2); the corpus spike on this day is the Hebrew-language repackaging - three @60minutes-clipped TikTok cuts together produce 66% of the day's reach.
"""


SEC_8C_MD = f"""<a id="sec-8c"></a>
## 8c. Stance distribution (custom fields)

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Surface the most informative `custom_fields.<field>` distribution given the user's framing (e.g. `candidate_stance`). Discover candidate fields by sampling `custom_fields`; pick the field that best discriminates against the framing question.

Use this table schema:

| Stance | Posts | Avg Reach / Post | Sentiment (Pro / Anti) |

**Label translation (load-bearing).** Raw `custom_fields` keys are snake_case English (`pro_bibi`, `anti_bennett`, …). Translate every label to a human phrase in the data's language. The raw key never appears in a customer-facing cell.

**Closing line - operational, not diagnostic.** Below the table, one short paragraph (not a bullet, not a "Reconciliation note:" heading) interpreting the gap between this table's stance-tagged count and §5's broader Posts count. Phrase it as an insight, not as a methodology footnote. Example phrasing:

  *"Of <Subject>'s 449 corpus mentions, only 107 are organic supporters; the rest is the rival camp's amplification machine. <Rival>'s own ratio is inverted - his supporters out-amplify his attackers by 2.5×."*

Do NOT write "data UNION", "Entity Match", "Candidate Stance" or the literal field names - those are implementation detail.

Query template:
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

If no `custom_fields` for this agent, REMOVE this widget.
"""


SEC_9_MD = f"""<a id="sec-9"></a>
## 9. Narratives, clusters, and hashtags

{VOICE}

{BODY_SKELETON}

**Agent instructions.** A table of live narrative clusters covering the period. Use `list_topics` to pull semantic clusters - reference **at least 5–10 by name** in the body.

| Cluster | Posts | Reach | Lead voices (handles) | Status | Recommended response |

- **Status:** `emerging` / `sustained` / `fading` / `dangerous`.
- **Lead voices:** specific handles, not categories.
- **Recommended response:** one operational line.

Rank rows by reach.

**Cluster vs. slice reconciliation (load-bearing).** Topic-cluster reach is keyword/embedding-based - it can undercount when the §7b platform×content_type slice picks up the same content. If a cluster's reach is materially smaller (>2×) than the §7b slice covering the same content, add ONE operational line that explains it. Example: *"The foreign-press cluster shows 945K here because the topic-extractor matched Hebrew references only; the actual airdate spike (5.3M, §7b) includes the English-language clips."*

Do NOT use the words "topic-extractor", "embedding", "cluster recall" or any technical framing in the body - the operational sentence above is fine.

Track **branded-hashtag adoption** explicitly. If the campaign's own hashtag has 0 appearances in 1,000+ posts, that's a finding, not a footnote.

**Cross-platform call-out (load-bearing).** Where narrative shape diverges between platforms (often the same actor reads completely different on each), flag it in 1–2 sentences after the table.

Reference the word-cloud widget once.

---

**Reference example.**

| Cluster | Posts | Reach | Lead voices | Status | Recommended response |
| :------ | ----: | ----: | :---------- | :----- | :------------------- |
| `<Subject>` mental fitness  |    78 | 690K | @rival1, @rival_outlet | dangerous | Reframe as `<RivalCamp>`-panic offensive |
| Coalition launch + merger   |   142 | 1.2M | @subject, @ally1, allies | sustained | Continue 1/day cadence first 3 weeks |
| `<Rival2>` `<Event>`        |    66 | 686K | @<news1>, @<news2> | fading | Reactivate within 48h via "responsible `<Wing>`" frame |

**Cross-platform note.** The launch reads as **coalition / strategy** on X (high pro/anti ratio, policy-flavored discussion) but reads as **personality / character** on TikTok (heavy anti-subject emotional content). Narrative tools must be platform-specific.

**Branded-hashtag adoption.** Campaign hashtag `<#TAG>` appears in 89 posts (3.6% of corpus) - under-adopted for a launch week.
"""


APPENDIX_MD = f"""<a id="sec-app"></a>
## Appendix - External grounding & methodology

{VOICE}

**Agent instructions.** ONE appendix in two clearly-named parts, separated by `###` sub-headers. Do not split into two widgets.

---

### A. External grounding (independent sources only)

**Strict rule - corpus platforms are FORBIDDEN here.** No `x.com`, `twitter.com`, `tiktok.com`, `youtube.com`, `instagram.com`, `facebook.com` links. The corpus posts those platforms produced are NOT external grounding - they are the data itself. External grounding means independent journalism, polls, market research, third-party reports, official statements from outlets/institutions OFF those platforms.

**Minimum: ≥3 distinct external hostnames**, ≥5 total links. If web grounding cannot produce ≥3 distinct news/poll/report domains, you have not actually grounded the report - re-run web grounding before publishing.

- Each entry: one-line summary, markdown link `[label](url)`, and the specific section it grounds (e.g. "grounds 7c inflection MM-DD" or "grounds §2 event-date for `<Event>`").
- Group by type when there are enough (Polls / Press / Market / Official / Regulatory).
- **Run web grounding for each verified event in §2** - the article you used to date the event is exactly the link that belongs here.
- A source that doesn't connect to a specific body finding doesn't earn its place.

**SERP and placeholder URLs rejected.** `google.com/search?q=…`, `bing.com/search?q=…`, `…/sample-url`, `example.com`, etc. are forbidden - `verify_dashboard` rejects them.

---

**Reference example.**

#### Press
- **[`<Outlet1>` - "<Headline>" (2026-MM-DD)](https://www.outlet1.example/article-id).** Reports the announcement of `<Event>`; **grounds §2 verified event-date for `<Event>` and §7c inflection MM-DD**.
- **[`<Outlet2>` - "<Headline2>" (2026-MM-DD)](https://www.outlet2.example/article).** Attack-line coverage; **grounds §9 cluster `<cluster>`**.

#### Polls
- **[`<Pollster>` - `<Poll-Topic>` (2026-MM-DD)](https://www.pollster.example/polls/2026-05).** `<Subject>` bloc projected at 36 seats vs. `<Rival1>` 27; **grounds §4 consolidation claim**.

#### Market / context
- **[`<Institution>` - `<Report>` (2026-Q2)](https://www.institution.example/reports/q2-2026).** 31% trust in `<institution>`; **grounds §12 audience cohort**.

---

### B. Methodology & sources

**Agent instructions.** Plain operational language. Describe what was done, not which functions were called. Internal tool names (`entity_metrics`, `scope_posts`, `execute_sql`, `list_topics`) and signal labels (`Entity Match`, `Candidate Stance`, `UNION`) MAY appear here - but the reader still benefits from a plain-language explanation alongside the slug.

Cover:
- **Data scope** - agent ID, source-collection count.
- **Period** - exact start / end timestamps.
- **Corpus** - total posts (raw / dedup), platform mix, language mix.
- **Classification** - how sentiment / stance / emotion / themes were derived. Plain language; no jargon-only sentences.
- **External sources consulted** - count and brief description, with link back to Part A.
- **Data-quality scoreboard** (required) - per-field non-null coverage:

| Field | Non-null % | Notes |
| :---- | ---------: | :---- |
| sentiment | 98.4% | Standard 3-class |
| emotion | 92.1% | 7 categories |
| entities | 76.3% | Exact-name extraction |
| custom_fields.<field1> | 88.7% | Stance enrichment |
| themes | 95.5% | |

- **Known data gaps** - platforms missing, periods sparse, voices absent, enrichment fields not populated. Be specific. **Confident silence beats false synthesis.** If a finding upstream was hedged because of a data gap, name the gap here.
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
        _text("v6hdr0000a", HEADER_MD, h=3),
        _text("v6sec02met", SEC_2_MD, h=20),
        _text("v6sec03toc", SEC_3_MD, h=14),
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        _text("v6sec04exe", SEC_4_MD, h=24),
        _text("v6sec05sov", SEC_5_MD, h=28),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("v6sec06pos", SEC_6_MD, h=32),
        _text("v6sec07chr", SEC_7_MD, h=30),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("v6sec08a00", SEC_8A_MD, h=26),
        _text("v6sec08b00", SEC_8B_MD, h=14),
        _text("v6sec08c00", SEC_8C_MD, h=18),
        _text("v6sec08d00", SEC_8D_MD, h=12),
        _text("v6sec09nar", SEC_9_MD, h=22),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("v6sec10plt", SEC_10_MD, h=14),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        _text("v6sec11chn", SEC_11_MD, h=20),
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("v6sec12aud", SEC_12_MD, h=18),
        _text("v6sec13rsk", SEC_13_MD, h=16),
        _text("v6sec14int", SEC_14_INTRO_MD.replace("<a id=\"sec-14\"></a>", "<a id=\"sec-14\"></a>"), h=6),
        _text("v6sec14r01", SEC_14_X_MD_TEMPLATE.format(n=1), h=18),
        _text("v6sec14r02", SEC_14_X_MD_TEMPLATE.format(n=2), h=18),
        _text("v6sec14r03", SEC_14_X_MD_TEMPLATE.format(n=3), h=18),
        _text("v6sec14r04", SEC_14_X_MD_TEMPLATE.format(n=4), h=18),
        _text("v6sec14r05", SEC_14_X_MD_TEMPLATE.format(n=5), h=18),
        _text("v6secapp00", APPENDIX_MD, h=36),
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
        # Default fall-through path: full-width text widgets are inset by 1
        # column to match the header's narrowed layout (x=1, w=10 on a 12-col
        # grid). The user narrowed the header in v6 and asked for the same
        # treatment everywhere - this matches that visual rhythm.
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
    title = "Weekly Competitive Brand Report (Template v6)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"v6 layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN - not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(V6_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V6_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    now_iso = "2026-05-14T12:00:00+00:00"
    db.collection("explorer_layouts").document(V6_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v6 template: dashboard_layouts/{V6_TEMPLATE_ID}")
    print(f"Wrote v6 explorer entry: explorer_layouts/{V6_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
