"""Build the v3 weekly competitive brand report template.

Changes from v2 (f7c9e2b81e1a4d9caaa18b5f3d2c7a04):
  - Section headers no longer carry the § symbol. Plain numbers ("2. Metadata"),
    or "Appendix" for the appendix. The agent localizes to Hebrew without § too.
  - Appendix A + Appendix B merged into ONE widget with two parts.
  - 7b format/channel performance sub-table restored (lost from v1→v2).
  - 9 narratives table now requires a reach/exposure column.
  - 8a top-posts schema gets a "Link" column — agent must link the actual post URL.
  - Body skeleton standardized: opening paragraph → table → closing paragraph
    → chart reference (when applicable). Every section follows the same shape.
  - Tone block injected into every section brief: senior intelligence analyst,
    decision-ready, no casual humor, no "cool".
  - Forbids section renumbering after removal (e.g. §8b removed ≠ rename 8c→8b).
  - Widget heights raised: prior heuristic under-sized text widgets, causing
    scroll. v3 sizes per-section based on observed v2-output content lengths.
  - is_template: true on the doc.

Chart widget configs copied byte-identical from v2.

Usage:
    uv run python scripts/build_dashboard_template_v3.py [--dry-run]
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

from api.deps import get_fs  # noqa: E402

V3_TEMPLATE_ID = "c0a8d9e1f203450aa15b3c2d4e5f6a7b"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Universal voice block (prepended into every section's instructions) ────

VOICE = (
    "**Voice.** Senior intelligence analyst writing for a decision-maker who paid "
    "for this analysis. Direct, sharp, decision-ready. No casual humor, no "
    "self-conscious wit, no 'this is cool' framing. Respect the reader; "
    "lead with the finding."
)

BODY_SKELETON = (
    "**Body skeleton (every section follows this shape).** "
    "1) Opening paragraph — what is the headline finding for this section. "
    "2) Table or compact list — the data. "
    "3) Closing paragraph — interpretation and so-what. "
    "4) Reference to the matching chart widget (when one exists), one sentence. "
    "Do not invert this order."
)


# ─── Text briefs ────────────────────────────────────────────────────────────

HEADER_MD = """# Weekly Competitive Brand Report — `<Subject>` (Week of `<YYYY-MM-DD>` → `<YYYY-MM-DD>`)

**Template v3.** Every text widget below carries (a) an instruction to the agent and (b) a compact reference example. At runtime the agent replaces both with the actual current-period analysis. Chart widgets pull live data from the agent's scope — configs are frozen.
"""

SEC_2_MD = f"""## 2. Metadata & contextual frame

{VOICE}

**Agent instructions.** Open with a quantitative spec block (one line per field, in this exact order), then a 2–3 line contextual frame. Numbers are real or `n/a` — never a hedge. Localize field labels into the data's language; preserve order.

```
- Period: <YYYY-MM-DD> → <YYYY-MM-DD>
- Total posts: <raw> raw / <dedup> after dedup
- Platforms: <Platform1> <X.X%> · <Platform2> <X.X%> · …
- Languages: <Lang1> <X.X%> · …
- Reach (total views): <N>
- Engagement (likes + comments + shares): <N>
- Monitoring agent: <agent_id>
- Source collections: <name or count>
- Primary entities tracked: <Entity1>, <Entity2>, …
```

Close with a **Contextual frame** — 2–3 lines: where this period sits in the longer campaign arc (early / mid / late) and what happened in the world during it that matters. Positioning, not background.

---

**Reference example (shape only).**

```
- Period: 2026-MM-DD → 2026-MM-DD
- Total posts: 2,672 raw / 2,457 after dedup
- Platforms: Twitter 71% · TikTok 29%
- Languages: <Lang> 96% · <Lang2> 3% · <Lang3> 1%
- Reach (total views): 22.6M
- Engagement: 1.42M
- Monitoring agent: <agent_id>
- Source collections: 19 collections
- Primary entities tracked: <Subject>, <Rival1>, <Rival2>, …
```

**Contextual frame.** Week 1 post-launch of `<Subject>`'s coalition. Mid-stage of a multi-week campaign. External: opening attack from `<RivalCamp>` on `<AxisX>`; recruitment shifts among `<RivalCamp2>`. The period sits at the inflection between launch momentum and the first credible counter-narrative.
"""

SEC_3_MD = """## 3. Table of contents

**Agent instructions.** A clean, linked list of every section and the appendix, in order. Tight, no commentary. Mirror the actual section IDs used in the body.

**Anchor rule (load-bearing).** GitHub-flavored auto-anchors fail for non-Latin scripts. Place an explicit HTML anchor on its own line immediately above every section heading: `<a id="sec-N"></a>` (`sec-4`, `sec-8a`, `sec-app`, etc.). Reference these IDs in the TOC as `[Section title](#sec-N)`. Never link to the heading text itself.

**Renumbering forbidden.** If you remove a sub-widget (e.g. §8b for missing emotion data), the surviving sub-sections keep their letters — 8c stays `8c`, 8d stays `8d`. Do not slide them down to fill the gap. The TOC shows only the sub-sections that exist.

---

**Reference example.**

```markdown
## Table of contents

1. [Executive summary](#sec-4)
2. [Share of Voice & KPI dashboard](#sec-5)
3. [Competitive positioning — per actor](#sec-6)
4. [Chronology — what shaped the week](#sec-7)
5. Subject deep dive
   - 5a. [Top posts — pro & anti](#sec-8a)
   - 5b. [Tone & emotion correlation](#sec-8b)
   - 5c. [Stance distribution (custom fields)](#sec-8c)
   - 5d. [What was missed](#sec-8d)
6. [Narratives, clusters, hashtags](#sec-9)
7. [Platform comparison](#sec-10)
8. [Channels & amplifiers](#sec-11)
9. [Audience insights](#sec-12)
10. [Risks & opportunities](#sec-13)
11. Operational recommendations
   - [14.1](#sec-14-1) · [14.2](#sec-14-2) · [14.3](#sec-14-3) · [14.4](#sec-14-4) · [14.5](#sec-14-5)
- [Appendix — External context & methodology](#sec-app)
```
"""

SEC_4_MD = f"""<a id="sec-4"></a>
## 4. Executive summary

{VOICE}

{BODY_SKELETON}

**Agent instructions.**

1. Open with the single most important insight given the user's framing — no preamble. One sentence naming actors, direction, and the strategic stake.
2. Then **4–6 callout findings**, each a bolded one-line title + one short hard-claim paragraph that cites actors, numbers, and direction. Bold the load-bearing words. No finding survives without a number, a named account, or a specific post.
3. Close with **up to 5 operational recommendations for the next period** in a numbered list. Each: (i) the specific number / finding that motivates it, (ii) a target date or window, (iii) a one-line execution template. These are *headlines*; the long form lives in 14.1–14.5. If the analysis produces fewer than 5, write fewer — and remove the unused §14.x sub-widgets via `update_dashboard`.

**Hard rule.** No finding survives that the subject would say about themselves anyway, or that could be guessed without the data.

---

**Reference example.**

> `<Subject>` is winning the contest of **initiative** but is now under coordinated and effective attack on **`<AxisX>`** — and the data shows the campaign has not matched the attack with a counter-narrative of equivalent reach.

**Findings (excerpt — full version has 4–6):**

- **`<Rival1>` dominates reach but bleeds sentiment.** 8.1M views; **136 pro / 344 anti** — the worst ratio in the field. Compensated by viral `<Format>` content (one item alone = 3.5M views).
- **The `<RivalCamp>` "<AttackLine>" landed.** Three pro-`<RivalCamp>` posts crossed 300K combined views; `<Subject>`'s response (50K views) is **6× under-amplified** vs. the attack.
- **`<Rival2>`'s `<Event>` was a gift the `<Subject>` camp did not collect.** 686K views of organic anger — `<Subject>` published **zero** posts framing it.

**Operational recommendations (headlines):**

1. **Convert the libel suit into an offensive narrative**, not a defensive note. Target: 48h.
2. **Take the "responsible `<Wing>`" position on `<Rival2>`**. Target: this week.
3. *(… up to 3 more, each with quantitative justification and execution template.)*
"""

SEC_5_MD = f"""<a id="sec-5"></a>
## 5. Share of Voice & KPI dashboard

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Build one row per material actor. **Rank by reach.** Use this exact column schema (no extra columns, no dropped columns):

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Indicator |

- **Posts**: count of in-scope posts by or about the actor.
- **Reach**: sum of views.
- **SoV %**: share of total reach (or share of total posts when reach is unreliable — say which in one footnote).
- **Sentiment (Pro / Anti)**: `<pro count> / <anti count>`.
- **Indicator**: ONE glyph convention, used consistently. Default: reach trajectory — 🟢 leading by reach, 🟡 contested, 🔴 trailing. (NOT sentiment.)

**Data sources — two-signal UNION (load-bearing).** Build §5 from a UNION of two signals, presented in ONE table (not split across sections):
- `social_listening.entity_metrics(...)` — exact-string match on `entities`.
- `custom_fields.candidate_stance` — stance-tagged posts that mention the actor implicitly.

Report `Posts` and `Reach` as the union, deduped by `post_id`. If the two signals diverge by >2×, add a one-line note ("entity-match: N; stance: M; reported: union").

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

Below the table, **1–2 paragraphs** that interpret the asymmetries (volume vs. reach leaders, worst pro/anti ratio, who is silent, who is over-amplified). Table = what; paragraph = so what. Reference the stacked-bar chart widget once.

---

**Reference example (shape only).**

| Actor              | Posts | Reach     | SoV % | Sentiment (Pro / Anti) | Indicator |
| :----------------- | :---: | :-------: | :---: | :--------------------: | :-------: |
| `<Rival1>`         |  509  | 8,134,766 | 36.0% |        136 / 344       |     🟢    |
| `<Subject>`        |  362  | 4,641,794 | 20.5% |         85 / 249       |     🟢    |
| `<Rival2>`         |  266  | 2,167,018 |  9.6% |         46 / 204       |     🟡    |
| `<Rival3>`         |  217  | 1,767,492 |  7.8% |         59 / 132       |     🟡    |

*SoV % = share of total reach (22.6M). Counts UNION entity-match and stance-tagged posts; deduped by `post_id`.*

**Strategic insight.** `<Rival1>`'s reach lead rests on a single viral mechanic (one `<Format>` item = 43% of his weekly reach); his **pro:anti ratio 1:2.5 is the worst in the field**. `<Subject>` holds a clean #2 with a stable sentiment profile and a credible gap to #3. The four trailing actors together produce 20.7% SoV — *less than `<Subject>` alone*.
"""

SEC_6_MD = f"""<a id="sec-6"></a>
## 6. Competitive positioning, per actor

{VOICE}

**Agent instructions.** Every material actor in scope gets a sub-section, written as **flowing prose** (not a bullet list). Inclusion bar is data-driven: ≥ 20 mentions via either signal OR ≥ 100K reach. If 8 actors clear, write 8 sub-sections.

**Header levels are load-bearing.** This section's heading is `## 6.`. Each actor sub-section uses `### <Actor> — "<dominant-narrative>"`. Never `##` for an actor sub-section.

Each sub-section opens with a 1–3 word "dominant narrative" tagline, then 2–4 paragraphs covering:

- What they did well — cite the specific top posts inline (date, format, views, message, *why it worked*).
- Where they were weak.
- What they missed (the move the data shows they could have made but didn't).

Bold the asymmetric findings. A 2–3 row embedded table of the actor's top posts is welcome where it earns its place; stacked bullet lists are not.

---

**Reference example (one sub-section).**

### `<Subject>` — *"initiative, under pressure"*

`<Subject>`'s week was structurally strong: the launch posted 1.27M views on the announcement alone, the formal merger created a coherent two-name brand without splitting reach, and `<Subject>` held the **#2 SoV position (20.5%)** with a stable sentiment profile (1 : 2.9 pro:anti). The strongest tactical move was the 1.1M-view post on `<TopicA>` — a hawkish signal that pre-empted `<RivalCamp>`'s "soft on `<TopicA>`" frame. **This is the post pattern to replicate**: short text, `<TopicA>`-anchored, morning window (07:30–09:00).

The weakness was **defensive posture against the "<AttackLine>"**. The libel-suit announcement scored well by its own measure (50K views, 8% engagement) but was 6× under-amplified vs. the aggregate attack (≈300K combined views across three accounts). The campaign treated it as a legal item rather than a narrative arc to be **reframed**.

What `<Subject>` **missed**: the `<Rival2>` `<Event>` opening — 686K views of organic anger; `<Subject>` published zero posts using this story. Cost: an estimated 0.3–0.5M earned-reach equivalent on a converting frame.

*(Repeat for every material actor in scope.)*
"""

SEC_7_MD = f"""<a id="sec-7"></a>
## 7. Chronology — what shaped the week

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Three sub-sections. Numbers and dates here are the highest-risk surface for errors — build every cell from a single query result, not memory. Sub-section headers use `###` (not `##`).

**7a. Day-by-day table.** One row per day in the requested period — **every day, even if the data is sparse**. Sparse days are signal, not noise; mark them `—` rather than dropping the row.

| Date | Posts | Reach | Pro / Anti | Dominant emotion / one-line daily inflection |

Fill missing days by left-joining against a generated date series, OR by explicitly listing every day in the period and marking blanks as `—`.

**7b. Format / channel performance.** A compact table over the same period. Rows are either platform × `content_type` (X-text, X-image, X-video, TikTok-video) **OR** `channel_type` (Official / Media / UGC / Influencer); pick whichever cuts the data best — one, not both.

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |

Call out over- or under-performing formats relative to their volume.

**7c. Inflection points.** In prose, name the 2–3 days that **changed the shape of the period** and what drove them. Each inflection cites specific post(s) — date, time, platform, account, views — sourced from the data. Tie each spike to either a verified external event (web grounding) or a specific post. Do not leave it as "volume rose".

Reference the daily-volume line chart on the dashboard once.

---

**Reference example.**

**7a. Day-by-day.**

| Date  | Posts | Reach | Pro / Anti | Daily inflection |
| :---- | ----: | ----: | :--------: | :--------------- |
| MM-DD |   391 |  4.1M |   95 / 130 | Launch — initiative |
| MM-DD |   368 |  3.4M |   82 / 121 | Foreign-policy signal; 1.1M post |
| MM-DD |    —  |   —   |     —      | (sparse — only N posts; cause: <reason>) |

**7b. Format / channel performance.**

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |
| :--- | ----: | ----------: | ---------------: | ---------------: | :------- |
| X — official statements | 12 | 1.55M | 129K | 10.5% | Few posts, huge per-post weight |
| X — text commentary     | 482 | 2.58M | 5.4K |  17.5% | Workhorse format for argumentation |
| TikTok — opinion video  |  17 | 434K  | 25K  |   2.9% | Punches above its volume |

**7c. Inflection points.**

- **MM-DD: launch.** Announcement post (1.27M views, @<subject>) sets the week's frame; pro reach +312% vs. baseline.
- **MM-DD: counter-attack lands.** Three pro-`<RivalCamp>` posts ([302K](https://x.com/...), [180K](https://x.com/...), [110K](https://x.com/...)) carry the "<AttackLine>" frame; `<Subject>`'s response under-amplified 6×.
"""

SEC_8A_MD = f"""<a id="sec-8a"></a>
## 8a. Subject deep dive — top posts, pro & anti

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Two sub-tables, each ranked by views (engagement as tie-breaker). Sub-section headers use `###`.

Use **this exact column schema for both tables — including the `Link` column** (mandatory; every cited post must point to its source URL):

| Date | Platform | Format | Account | Views | Likes | Link | Message (1 line, original language) | Why it worked / landed | Replication template / Counter-move |

- **Top 5 pro-subject posts.** Last column = **replication template**.
- **Top 5 anti-subject posts.** Last column = **counter-move**.
- **Link** column is `[view](URL)` — the actual `post_url` from the database. If the URL is missing, write `—` and add a footnote naming the missing-URL count.

Query template:
```sql
SELECT post_id, channel_handle, platform, content_type, posted_at, views, likes, content, post_url
FROM social_listening.scope_posts(@agent_id)
WHERE EXISTS (SELECT 1 FROM UNNEST(entities) e WHERE LOWER(e) IN UNNEST(@subject_variants))
  AND sentiment = @stance       -- 'positive' or 'negative'
  AND posted_at BETWEEN @period_start AND @period_end
ORDER BY views DESC
LIMIT 5
```

---

**Reference example (one row per table).**

**Top pro-subject posts (excerpt).**

| Date  | Platform | Format | Account     | Views | Likes | Link | Message | Why it worked | Replication template |
| :---- | :------: | :----: | :---------- | ----: | ----: | :--: | :------ | :------------ | :------------------- |
| MM-DD |    X     |  text  | @<subject>  | 1.27M | 38K  | [view](https://x.com/<subject>/status/...) | "<one-line message>" | Coherent two-name brand; clean stake | Morning post (07–09), foreign-policy anchor |

**Top anti-subject posts (excerpt).**

| Date  | Platform | Format | Account     | Views | Likes | Link | Message | Weakness exposed | Counter-move |
| :---- | :------: | :----: | :---------- | ----: | ----: | :--: | :------ | :--------------- | :----------- |
| MM-DD |    X     |  text  | @<rival>    |  302K |  3.3K | [view](https://x.com/<rival>/status/...) | "<attack message>" | `<Rival>`'s reach floor is structural | Avoid direct reply; pivot to `<TopicA>` |
"""

SEC_8B_MD = f"""<a id="sec-8b"></a>
## 8b. Tone & emotion correlation on subject's own content

{VOICE}

{BODY_SKELETON}

**Agent instructions.** When `emotion` enrichment is available, count which emotions on the **subject's own** content correlate with strong performance, and which under-perform. Average reach/post per emotion is the right cut. State the implication for tone next period.

Query template:
```sql
SELECT emotion, COUNT(*) AS posts, AVG(views) AS avg_reach, SUM(views) AS total_reach
FROM social_listening.scope_posts(@agent_id)
WHERE channel_handle IN UNNEST(@subject_handles)
  AND posted_at BETWEEN @period_start AND @period_end
  AND emotion IS NOT NULL
GROUP BY emotion
ORDER BY avg_reach DESC
```

**If emotion enrichment is unavailable, REMOVE this widget** (`update_dashboard(layout_id, removals=["<this-i>"])`). Do NOT fabricate emotion analysis. Note the removal in the appendix's data-quality scoreboard. The sibling widgets 8c/8d KEEP their letters — do not renumber them to 8b/8c.

---

**Reference example.**

| Emotion        | Posts | Avg Reach / Post | Total Reach | Implication                          |
| :------------- | ----: | ---------------: | ----------: | :----------------------------------- |
| trust          |    14 |          92,000 |       1.29M | High-performing tone — keep cadence |
| anger          |     7 |          18,000 |        126K | Under-performs trust 5× — pull back |
| excitement     |     5 |          71,000 |        355K | Strong on launch posts only         |

**Implication.** The subject's reach concentrates in *trust-anchored* posts. Anger-tagged content under-performs by 5×. Recommendation: anger-tagged posts only when the news cycle demands them, not as a default tone.
"""

SEC_8C_MD = f"""<a id="sec-8c"></a>
## 8c. Stance distribution (custom fields)

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Surface the most informative `custom_fields.<field>` distribution given the user's framing (e.g. `candidate_stance`, `<merger>_sentiment`, `<topic>_position`). Discover candidate fields by sampling `custom_fields`; pick the field that best discriminates against the framing question.

Use this table schema:

| Stance | Posts | Avg Reach / Post | Sentiment (Pro / Anti) |

Below the table, **a one-line reconciliation note** with the §5 SoV row for the same actor — name the gap between entity-match and stance counts in absolute numbers, not in prose.

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

If no `custom_fields` for this agent, REMOVE this widget. Do not write hand-wavy stance prose without data.

---

**Reference example.**

| Stance              | Posts | Avg Reach / Post | Sentiment (Pro / Anti) |
| :------------------ | ----: | ---------------: | :--------------------- |
| pro_<subject>       |    70 |       14,958     |   56 / 12              |
| anti_<subject>      |   103 |        5,685     |    0 / 103             |
| pro_<rival>         |   109 |       35,356     |   88 / 17              |
| anti_<rival>        |   264 |       11,131     |    1 / 263             |

**Reconciliation note.** §5 SoV shows 319 entity-match mentions for `<Subject>`; stance-tagged posts here add 173 (70 pro + 103 anti). §5's number is the UNION of both signals; this table shows the stance breakdown alone.
"""

SEC_8D_MD = f"""<a id="sec-8d"></a>
## 8d. What was missed

{VOICE}

**Agent instructions.** A candid list of opportunities the subject did **not** capitalize on. Each item names:
- The specific opportunity (with date and one-line description).
- The cost (lost reach, ceded narrative ground, missed news cycle — quantified).
- Why it matters strategically.

This sub-section is what separates an analyst from a clipping service. **Do not soften.** If the campaign missed something, say so plainly and price it.

---

**Reference example.**

- **`<Rival2>` `<Event>` (MM-DD).** 686K views of organic anger at `<the-trigger>`. `<Subject>` owns the "responsible `<Wing>`" frame more than any rival; the campaign published zero posts using this story. **Cost: ≈0.3–0.5M earned-reach on a converting frame.**
- **`<Rival3>` `<Controversy>` (MM-DD → MM-DD).** 204 anti-`<Rival3>` posts, average 5.4K reach; `<Subject>` did not link economic record vs. `<Rival3>`'s. **Cost: ceded "competent `<Wing>`" ground.**
"""

SEC_9_MD = f"""<a id="sec-9"></a>
## 9. Narratives, clusters, and hashtags

{VOICE}

{BODY_SKELETON}

**Agent instructions.** A table of live narrative clusters covering the period. Use `list_topics` to pull semantic clusters — reference **at least 5–10 by name** in the body.

Schema (the `Reach` column is mandatory — without it cluster importance is unintelligible):

| Cluster | Posts | Reach | Lead voices (handles) | Status | Recommended response |

- **Status:** `emerging` / `sustained` / `fading` / `dangerous`.
- **Lead voices:** specific handles, not categories.
- **Recommended response:** one operational line.

Rank rows by reach.

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

**Branded-hashtag adoption.** Campaign hashtag `<#TAG>` appears in 89 posts (3.6% of corpus) — under-adopted for a launch week. Rival hashtag `<#RIVAL_TAG>` appears in 142 posts.
"""

SEC_10_MD = f"""<a id="sec-10"></a>
## 10. Platform comparison

{VOICE}

{BODY_SKELETON}

**Agent instructions.** When the data spans multiple platforms, an explicit comparison.

| Platform | Post share % | Reach share % | Pro % | Anti % | Audience implication |

One paragraph below naming the asymmetry and what it implies *strategically*. The Sentiment Mix doughnut and Platform Mix bar are the visual anchors — reference once.

If the corpus is single-platform, REMOVE this widget rather than writing "n/a" prose.

---

**Reference example.**

| Platform | Post share % | Reach share % | Pro % | Anti % | Audience implication |
| :------- | -----------: | ------------: | ----: | -----: | :------------------- |
| Twitter (X) |       71.2% |         62.5% | 34.1% |  41.2% | Older, news-reading, party-aligned; debate-heavy |
| TikTok     |       28.8% |         37.5% | 22.8% |  51.4% | Younger, virality-driven; **higher anti-incumbent skew** |

**Strategic asymmetry.** TikTok carries 1.3× its post-share in reach but **+10 pts more anti-** sentiment than X. For `<Subject>`, the platform that grows fastest is also where they're most vulnerable to character attacks. Reach growth on TikTok without tone-correction risks net-negative results.
"""

SEC_11_MD = f"""<a id="sec-11"></a>
## 11. Channels & amplifiers

{VOICE}

**Agent instructions.** Three sub-sections (`###` headers). The Top Channels widget on the dashboard is the data source — *interpret* it, do not re-table it.

**11a. Top channels.** Reference the widget's top 10 channels by handle. In one paragraph: which are official, which are media, which are UGC; who is amplifying the subject; who is amplifying rivals.

**11b. Subject's owned-channel performance.** If the subject has ≥2 owned channels, use this table:

| Channel | Platform | Posts | Avg reach / post | Avg engagement rate | Best post (link) |

If the subject has ONE channel, **write a paragraph** instead of a 1-row table. The paragraph names the channel, posts this period, avg reach, engagement rate, best post (with link), and one observation on cadence.

**11c. Missed amplification opportunities.** 3–5 UGC accounts or media outlets that consistently amplify *adjacent* messaging but did NOT amplify the subject this week. List handles + the post they should have amplified but didn't. Verify each handle's prior alignment via `execute_sql`.

---

**Reference example.**

**11b. Subject's owned channels.**

| Channel | Platform | Posts | Avg reach / post | Engagement rate | Best post |
| :------ | :------: | ----: | ---------------: | --------------: | :-------- |
| @subject_main      |    X    |  12 | 342K | 4.8% | [MM-DD launch (1.27M)](https://x.com/...) |
| @subject_movement  |    X    |   8 |  98K | 3.1% | [MM-DD post (1.1M)](https://x.com/...) |
| @subject_tiktok    | TikTok  |  14 | 128K | 5.7% | [MM-DD family content (520K)](https://tiktok.com/...) |
"""

SEC_12_MD = f"""<a id="sec-12"></a>
## 12. Audience insights

{VOICE}

**Agent instructions.** Who is actually doing the talking. Three to four short paragraphs covering:

- **Dominant cohorts** (age band, region, language, platform skew where the data supports it).
- **Named influencer accounts** with handles — not "various influencers".
- **Audience overlap with adjacent actors** — when commenters under subject posts also engage with rival accounts. **Quantify the overlap explicitly** (e.g., "41% of accounts commenting on the subject's launch also commented on `<Rival>` within the prior 14 days"). Without a number, the section's load-bearing finding is missing.
- **Persuasion targets vs. lost causes.** Who is gettable, who is not, with one line each.

If demographic enrichment isn't available, replace claims with what *is* observable: handle patterns, follower-count distributions, time-of-engagement patterns. Do not fabricate cohort descriptions.

Overlap query template:
```sql
WITH subj AS (
  SELECT DISTINCT commenter_handle FROM <comments_table>
  WHERE post_channel = '@<subject>' AND posted_at BETWEEN @start AND @end
),
riv AS (
  SELECT DISTINCT commenter_handle FROM <comments_table>
  WHERE post_channel = '@<rival>' AND posted_at BETWEEN @start - INTERVAL 14 DAY AND @end
)
SELECT
  (SELECT COUNT(*) FROM subj INNER JOIN riv USING (commenter_handle)) AS overlap,
  (SELECT COUNT(*) FROM subj) AS subj_total
```

---

**Reference example.**

The dominant pro-`<Subject>` cohort on X is **center-`<wing>` adults 35–55**, identifiable by handle patterns (heavy concentration of `<patternA>`, military-rank prefixes, reservist-flagged bios). Engagement clusters in 07:00–10:00 — workday morning, consistent with a working professional base. On TikTok the pro-`<Subject>` audience is materially younger and **smaller** — average post engagement < 1/4 of the X analog.

**Load-bearing overlap finding.** 41% of accounts commenting on the subject's launch post also commented on `<Rival3>` launch content within the prior 14 days. This is a **persuasion-target zone**, not a loyalty base — these voters are shopping for an alternative.

**Lost causes:** the anti-`<Subject>` TikTok cohort engaging with the "<AttackLine>" line shows near-zero crossover into pro-`<Subject>` content (3% overlap). Do not spend energy here.
"""

SEC_13_MD = f"""<a id="sec-13"></a>
## 13. Risks & opportunities

{VOICE}

**Agent instructions.** Two compact tables. Operational, not philosophical. Each row names a specific item, not a category.

**Risks.**

| Risk | Area | Urgency | Recommended action |

- Urgency: `critical` / `high` / `medium` / `low`. Use sparingly — not everything is critical.

**Opportunities.**

| Opportunity | Size (est.) | Time window | Recommended next move |

- Size: a number or reach band, not "big".
- Time window: a date range, not "soon".

---

**Reference example.**

**Risks.**

| Risk | Area | Urgency | Recommended action |
| :--- | :--- | :------ | :----------------- |
| "<AttackLine>" consolidates into `<RivalCamp>` doctrine | Defensive — character | **critical** | Counter-narrative arc within 72h; see 14.1 |
| TikTok anti-skew compounds with no `<Subject>` TikTok answer | Defensive — platform | high | Daily on-camera TikTok 18:00–22:00 |

**Opportunities.**

| Opportunity | Size (est.) | Time window | Recommended next move |
| :---------- | :---------- | :---------- | :-------------------- |
| `<Rival2>` `<Event>` — "responsible `<Wing>`" reframe | 0.3–0.5M earned reach | 48h | Split-screen video; see 14.2 |
"""

SEC_14_INTRO_MD = f"""<a id="sec-14"></a>
## 14. Operational recommendations — detailed

{VOICE}

**Agent instructions for the whole §14.** The long form of the recommendations from §4. Each lives in its own sub-section widget (14.1 through 14.5). If §4 lists fewer than 5, REMOVE the unused sub-section widgets via `update_dashboard(layout_id, removals=[...])`. Do not leave empty placeholders. Do not renumber after removal — 14.4 stays 14.4 even if 14.3 was dropped.

Required content per recommendation:

1. **Quantitative justification** — the finding from this report that motivates it, cited by section.
2. **Execution plan** — calendar table: `Day | Time | Channel | Format | Template`.
3. **Specific accounts / formats / times** to target.
4. **Success KPI** — what measurement says it worked, and the threshold.

Generic recommendations ("increase engagement", "use more video") fail the specificity test and must be cut.
"""

SEC_14_X_MD_TEMPLATE = f"""<a id="sec-14-{{n}}"></a>
### 14.{{n}} — `<headline matching §4 item {{n}}>`

{VOICE}

**Agent instructions.** Expand the §4 headline recommendation #{{n}} into a full operational plan. If §4 has fewer than {{n}} recommendations, REMOVE this widget rather than filling with placeholder content.

Required structure:
- **Justification (cite §X, §Y, …).** Specific findings from earlier sections.
- **Execution plan** — calendar table: `Day | Time | Channel | Format | Template`. Time windows must be specific ("09:00–09:30"), not vague ("morning").
- **Target accounts for amplification.** Named handles, with one-line "why this account".
- **Success KPI.** Specific threshold and time window.

---

**Reference example.**

**Justification (§4, §5, §9, §13).** Three pro-`<RivalCamp>` posts (combined 308K views) carried "<AttackLine>". `<Subject>`'s libel-suit response (50K views) is 6× under-amplified. Cluster `<Subject> mental fitness` is flagged `dangerous` in §9.

**Execution plan — 72h cadence.**

| Day  | Time  | Channel             | Format            | Template |
| :--- | :---: | :------------------ | :---------------- | :------- |
| Day 1 | 08:00 | @<subject> (X) | text thread (4 posts) | "Three falsehoods, three corrections" |
| Day 1 | 19:00 | @<subject>_movement + 4 aligned influencers | quote-card image | Side-by-side comparison |
| Day 2 | 09:00 | @<subject>_tiktok | 45s video | On-camera response monologue, no studio set |

**Target accounts for amplification:** @ally1, @ally2, @ally3 — confirmed aligned center-`<wing>` (§11c).

**Success KPI.** Cumulative reach ≥ 600K within 72h (2× the original attack). Sentiment ratio on the libel-suit narrative shifts from 2.1 : 1 (pro) to ≥ 4 : 1.
"""

APPENDIX_MD = f"""<a id="sec-app"></a>
## Appendix — External context & methodology

{VOICE}

**Agent instructions.** This is ONE appendix, in two parts, separated by `###` sub-headers. Do not split into two widgets.

---

### A. External context (web grounding)

**MANDATORY — ≥ 5 sources with WORKING article URLs.** Polls, press articles, web research, market data, third-party reports. Use **web grounding** to pull current sources.

- Each entry: one-line summary, markdown link `[label](url)`, and the specific section it grounds (e.g. "grounds 7c inflection MM-DD").
- **URL hygiene.** Links must point to a specific article, poll page, or report — NOT to a Google/Bing search results URL. SERP URLs do not count as grounding.
- Group by type when there are enough (Polls / Press / Market / Official / Regulatory).
- Run web grounding for each inflection point in 7c and any anomaly explanation in the body.
- A source that doesn't connect to a specific body finding doesn't earn its place.

**No web grounding in this session = defect, not a permissible state.**

**Reference example.**

#### Polls
- **[<Outlet> — <Pollster> (YYYY-MM-DD)](https://outlet.example/polls/2026-05).** `<Subject>` bloc projected at 36 seats vs. `<Rival1>` 27. **Grounds §4** consolidation claim.

#### Press
- **[<Outlet> — "<Headline>" (YYYY-MM-DD)](https://outlet.example/article-id).** Launch coverage; **grounds §7c inflection MM-DD**.
- **[<Outlet2> — "<Headline2>" (YYYY-MM-DD)](https://outlet2.example/article).** Attack-line coverage; **grounds §9 cluster `<cluster>`**.

#### Market / context
- **[<Institution> — <Report> (YYYY-Q2)](https://institution.example/reports/q2-2026).** 31% trust in `<institution>`; **grounds §12 audience cohort**.

---

### B. Methodology & sources

**Agent instructions.** Transparent about what the data does and does not cover. One short paragraph + a structured list.

Required fields:
- **Data scope** — agent ID, total source-collection count.
- **Period** — exact start / end timestamps.
- **Corpus** — total posts (raw / dedup), platform mix, language mix.
- **Classification taxonomy** — sentiment categories, stance values, topic-cluster count from `list_topics`, emotion categories.
- **Tools used in this run** — `entity_metrics`, `execute_sql` queries, `list_topics`, web-grounding queries.
- **External sources consulted** — count, with link to Part A.
- **Data-quality scoreboard** (required) — per-field non-null coverage:

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

- **Known data gaps** — platforms missing, periods sparse, voices absent, enrichment fields not populated. Be specific.

**Confident silence beats false synthesis.** If a finding upstream was hedged because of a data gap, name the gap here.
"""


# ─── Chart widgets — copy verbatim from v2 ──────────────────────────────────


def _chart_widgets() -> list[dict]:
    return [
        {"i": "9663d3d12f", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 0, "w": 3, "h": 2, "title": "Total Posts"},
        {"i": "98546895ea", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 1, "w": 3, "h": 2, "title": "Total Reach"},
        {"i": "202cd25b9f", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 2, "w": 3, "h": 2, "title": "Total Engagement"},
        {"i": "bcd59c22e8", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 3, "w": 3, "h": 2, "title": "Engagement Rate"},
        {"i": "13246f5607", "chartType": "bar", "aggregation": "custom",
         "w": 10, "h": 8, "title": "Post Count by Entity (sentiment mix)",
         "figureText": "Share of voice across material actors, split by post sentiment. Anchor for §6.",
         "customConfig": {
            "topN": 12, "includeOthers": False, "dimension": "entities",
            "metric": "post_count", "breakdownDimension": "sentiment",
            "barOrientation": "horizontal", "stacked": True}},
        {"i": "ae7bfdcab8", "chartType": "line", "aggregation": "custom",
         "w": 10, "h": 6, "title": "Daily Volume by Sentiment",
         "figureText": "Day-by-day post count, broken down by sentiment. Anchor for §7.",
         "customConfig": {
            "timeBucket": "day", "dimension": "posted_at", "metric": "post_count",
            "metricToggle": ["post_count", "view_count"],
            "breakdownDimension": "sentiment"}},
        {"i": "fa75ec9fdb", "chartType": "word-cloud", "aggregation": "theme-cloud",
         "w": 10, "h": 7, "title": "Theme Cloud",
         "figureText": "Qualitative landscape of themes across the corpus. Anchor for §9 (Narratives)."},
        {"i": "102d4ef2b1", "chartType": "doughnut", "aggregation": "sentiment",
         "w": 5, "h": 6, "title": "Sentiment Mix"},
        {"i": "6f616f581a", "chartType": "bar", "aggregation": "platform",
         "w": 5, "h": 6, "title": "Platform Mix"},
        {"i": "bad3e8fbe0", "chartType": "table", "aggregation": "channels",
         "w": 10, "h": 8, "title": "Top Channels",
         "figureText": "Top amplifying channels by post count, with average reach and engagement. Anchor for §11.",
         "tableConfig": {
            "showRank": True, "sortDir": "desc", "dimension": "channel_handle",
            "rowLimit": 15, "sortBy": "totalviews",
            "columns": [
                {"id": "posts", "metric": "post_count", "header": "Posts"},
                {"id": "totalviews", "agg": "sum", "metric": "view_count", "header": "Total Views"},
                {"id": "avgviews", "agg": "avg", "metric": "view_count", "header": "Avg Views/Post"},
                {"id": "avglikes", "agg": "avg", "metric": "like_count", "header": "Avg Likes"},
                {"id": "platform", "dimension": "platform", "header": "Platform", "kind": "dimension"},
                {"id": "channeltype", "dimension": "channel_type", "header": "Type", "kind": "dimension"},
            ]}},
    ]


# ─── Layout assembly ────────────────────────────────────────────────────────


def _text(i: str, md: str, h: int, w: int = 12) -> dict:
    """Build a text widget with explicit height (rows of 48px each)."""
    return {
        "i": i,
        "chartType": "table",
        "aggregation": "text",
        "w": w,
        "h": h,
        "title": "Text",
        "markdownContent": md,
    }


# Heights tuned to expected agent-filled content (post-brief replacement).
# Calibration: rough rule of thumb is `h ≈ char_count / 90 + 4`, with table-heavy
# sections rounded up a row or two.
def build_layout() -> list[dict]:
    charts = {w["i"]: w for w in _chart_widgets()}

    seq: list[dict] = [
        _text("v3hdr0000a", HEADER_MD, h=3),
        _text("v3sec02met", SEC_2_MD, h=14),
        _text("v3sec03toc", SEC_3_MD, h=14),
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        _text("v3sec04exe", SEC_4_MD, h=24),
        _text("v3sec05sov", SEC_5_MD, h=24),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("v3sec06pos", SEC_6_MD, h=32),
        _text("v3sec07chr", SEC_7_MD, h=26),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("v3sec08a00", SEC_8A_MD, h=26),
        _text("v3sec08b00", SEC_8B_MD, h=14),
        _text("v3sec08c00", SEC_8C_MD, h=18),
        _text("v3sec08d00", SEC_8D_MD, h=12),
        _text("v3sec09nar", SEC_9_MD, h=22),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("v3sec10plt", SEC_10_MD, h=14),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        _text("v3sec11chn", SEC_11_MD, h=20),
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("v3sec12aud", SEC_12_MD, h=18),
        _text("v3sec13rsk", SEC_13_MD, h=16),
        _text("v3sec14int", SEC_14_INTRO_MD, h=8),
        _text("v3sec14r01", SEC_14_X_MD_TEMPLATE.format(n=1), h=18),
        _text("v3sec14r02", SEC_14_X_MD_TEMPLATE.format(n=2), h=18),
        _text("v3sec14r03", SEC_14_X_MD_TEMPLATE.format(n=3), h=18),
        _text("v3sec14r04", SEC_14_X_MD_TEMPLATE.format(n=4), h=18),
        _text("v3sec14r05", SEC_14_X_MD_TEMPLATE.format(n=5), h=18),
        _text("v3secapp00", APPENDIX_MD, h=34),
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
    title = "Weekly Competitive Brand Report (Template v3)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"v3 layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN — not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(V3_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V3_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    now_iso = "2026-05-13T15:00:00+00:00"
    db.collection("explorer_layouts").document(V3_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v3 template: dashboard_layouts/{V3_TEMPLATE_ID}")
    print(f"Wrote v3 explorer entry: explorer_layouts/{V3_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
