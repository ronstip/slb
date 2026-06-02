"""Build the v2 weekly competitive brand report template.

Differences from v1 (1f997ff1888c492290ba2dffb875ce58):
  - §1 (agent-only global instructions) - REMOVED. Those instructions live in
    the prompt; they don't belong in a rendered template widget.
  - §8 - split from one widget into four (8a, 8b, 8c, 8d) so the agent cannot
    silently drop tone/emotion correlation or custom-fields deep dive.
  - §14 - split from one widget into five (14.1, 14.2, 14.3, 14.4, 14.5) so
    the long-form recommendations are scaffolded explicitly; the agent
    REMOVES unused slots rather than skipping them silently.
  - §5 brief - drops the "do not re-aggregate from scope_posts" lock; allows
    broader signal (entity_metrics UNION custom_fields stance) so SoV reflects
    the actual field, not just exact-name posts.
  - §7a brief - explicitly requires every day in the requested period
    (sparse days = signal, not noise).
  - §App-A brief - stronger "no link, no source; no source, no Appendix A;
    no Appendix A, do not publish" enforcement.
  - §App-B brief - adds a required data-quality scoreboard (% non-null per
    enrichment field: sentiment, emotion, entities, custom_fields).
  - Reference examples - genericized to <Subject>/<Rival>/<Period> placeholders
    so the template reads as cross-campaign, not Bennett-specific.
  - is_template: true - set on the doc so the agent tools refuse to
    update/publish the template by mistake.

Chart widgets (KPI cards, entity bar, line, theme cloud, sentiment doughnut,
platform bar, top channels table) are copied byte-identical from v1.

Usage:
    uv run python scripts/build_dashboard_template_v2.py [--dry-run]
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

V1_TEMPLATE_ID = "1f997ff1888c492290ba2dffb875ce58"
V2_TEMPLATE_ID = "f7c9e2b81e1a4d9caaa18b5f3d2c7a04"   # stable, hex32
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Text briefs ────────────────────────────────────────────────────────────

HEADER_MD = """# Weekly Competitive Brand Report - `<Subject>` (Week of `<YYYY-MM-DD>` → `<YYYY-MM-DD>`)

**Template v2.** Every text widget below carries (a) an instruction to the agent and (b) a compact reference example. At runtime the agent replaces both with the actual current-period analysis. Chart widgets pull live data from the agent's scope; do not edit their configs.
"""

SEC_2_MD = """## §2 - Metadata & contextual frame

**Agent instructions.** Open with a quantitative spec block (one line per field, in this exact order), then a 2–3 line contextual frame. Numbers are real or `n/a` - never a hedge.

```
- Period: <YYYY-MM-DD> → <YYYY-MM-DD>
- Total posts: <raw> raw / <dedup> after dedup
- Platforms: <Platform1> <X.X%> · <Platform2> <X.X%> · …
- Languages: <Lang1> <X.X%> · <Lang2> <X.X%> · …
- Reach (total views): <N>
- Engagement (likes + comments + shares): <N>
- Monitoring agent: <agent_id>
- Source collections: <collection_id1>, <collection_id2>, …
- Primary entities tracked: <Entity1>, <Entity2>, …
```

Close with a **Contextual frame** - 2–3 lines: where this period sits in the longer campaign arc (early / mid / late) and what happened in the world during it that matters. Positioning, not background.

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
- Source collections: 19 collections (see Appendix B)
- Primary entities tracked: <Subject>, <Rival1>, <Rival2>, …
```

**Contextual frame.** Week 1 post-launch of `<Subject>`'s coalition merger. Mid-stage of a multi-week campaign. External: opening attack from `<RivalCamp>` on `<AxisX>`; recruitment shifts among `<RivalCamp2>`. The period sits at the inflection between launch momentum and the first credible counter-narrative.
"""

SEC_3_MD = """## §3 - Table of contents

**Agent instructions.** A clean, linked list of every section and appendix, in order. Tight, no commentary.

**Anchor rule (load-bearing).** GitHub-flavored auto-anchors fail for Hebrew, Arabic, and other non-Latin scripts - slugifying a translated heading produces a broken link. Place an explicit HTML anchor on its own line immediately above every section heading: `<a id="sec-N"></a>` (`sec-4`, `sec-8a`, `sec-app-a`, etc.). Reference these IDs in the TOC as `[Section title](#sec-N)`. Never link to the heading text itself.

---

**Reference example (shape only - agent generates the actual list for the run):**

```markdown
## Table of contents

1. [Executive summary](#sec-4)
2. [KPI dashboard & Share of Voice](#sec-5)
3. [Competitive positioning - per actor](#sec-6)
4. [Chronology - what shaped the week](#sec-7)
5. Subject deep dive
   - 5a. [Top posts - pro & anti](#sec-8a)
   - 5b. [Tone & emotion correlation](#sec-8b)
   - 5c. [Custom-field deep dive (stance)](#sec-8c)
   - 5d. [What was missed](#sec-8d)
6. [Narratives, clusters, hashtags](#sec-9)
7. [Platform comparison](#sec-10)
8. [Channels & amplifiers](#sec-11)
9. [Audience insights](#sec-12)
10. [Risks & opportunities](#sec-13)
11. Operational recommendations - detailed
   - [14.1](#sec-14-1) · [14.2](#sec-14-2) · [14.3](#sec-14-3) · [14.4](#sec-14-4) · [14.5](#sec-14-5)
- [Appendix A - External context](#sec-app-a)
- [Appendix B - Methodology & sources](#sec-app-b)
```
"""

SEC_4_MD = """<a id="sec-4"></a>
## §4 - Executive summary

**Agent instructions.**

1. Open with the single most important insight given the user's framing - no preamble, no "this report covers", no warm-up. One sentence naming actors, direction, and the strategic stake.
2. Then **4–6 callout findings**, each a bolded one-line title + one short hard-claim paragraph that cites actors, numbers, and direction. Bold the load-bearing words. No finding survives without a number, a named account, or a specific post.
3. Close with **5 operational recommendations for the next period** in a numbered list. Each: (i) the specific number / finding that motivates it, (ii) a target date or window, (iii) a concrete execution template. These are *headlines*; the long form lives in §14.1–§14.5.

**Hard rule.** No finding survives that the subject would say about themselves anyway, or that could be guessed without the data. Cut anything that fails this filter.

---

**Reference example (shape only).**

> `<Subject>` is winning the contest of **initiative** but is now under coordinated and effective attack on **`<AxisX>`** - and the data shows the campaign has not matched the attack with a counter-narrative of equivalent reach.

**Findings (excerpt - full version has 4–6):**

- **`<Rival1>` dominates reach but bleeds sentiment.** 8.1M views; **136 pro / 344 anti** - the worst ratio in the field. Compensates with viral `<Format>` content (one item alone = 3.5M views).
- **The `<RivalCamp>` "<AttackLine>" landed.** Three pro-`<RivalCamp>` posts on the line crossed 300K combined views; `<Subject>`'s response (50K views) is **6× under-amplified** vs. the attack.
- **`<Rival2>`'s `<Event>` was a gift the `<Subject>` camp did not collect.** 686K views of organic anger - `<Subject>` published **zero** posts framing it. A missed opportunity worth a specific recommendation in §14.

**Operational recommendations (headlines):**

1. **Convert the libel suit into an offensive narrative**, not a defensive note. Target: 48h.
2. **Take the "responsible `<Wing>`" position on `<Rival2>`** - compare frame, not policy frame. Target: this week.
3. *(… +3 more, each with quantitative justification and execution template.)*
"""

SEC_5_MD = """<a id="sec-5"></a>
## §5 - KPI dashboard & Share of Voice

**Agent instructions.** Build one row per material actor. **Rank by reach.** Use this exact column schema (no extra columns, no dropped columns):

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Indicator |

- **Posts**: count of in-scope posts by or about the actor.
- **Reach**: sum of views.
- **SoV %**: share of total reach (or share of total posts when reach is unreliable - say which in one footnote).
- **Sentiment (Pro / Anti)**: `<pro count> / <anti count>`.
- **Indicator**: pick **one** glyph convention and use it consistently across all rows. Default convention: **reach trajectory** - 🟢 leading by reach, 🟡 contested, 🔴 trailing. (NOT sentiment - sentiment has its own column.) Apply mechanically.

**Data sources - read carefully.** Build §5 from a UNION of two signals so it reflects the actual field, not just exact-name posts:
- **`social_listening.entity_metrics(...)`** (one call, every material actor) - exact-string match against `entities`. ⚠ Before calling, *sample* the `entities` array to see what's actually stored: `SELECT entity, COUNT(*) c FROM scope_posts(...) , UNNEST(entities) entity WHERE posted_at BETWEEN ... GROUP BY entity ORDER BY c DESC LIMIT 100`. Build `variants` from real strings only - variants match by *exact equality* after lowercase+trim, NOT substring. The result column is `entity` (not `canonical`).
- **`custom_fields.candidate_stance`** distribution (or whatever stance / topic field the enrichment carries) - captures stance-tagged posts even when the actor isn't named. Often 3–10× wider than entity_metrics for political subjects.

Report `Posts` and `Reach` as the union (`entity_metrics.mentions + stance_only_count`) when both signals exist for the actor. If the two signals diverge by >2×, add a one-line note ("counts via entity-match: N; via stance: M; reported number unions both, dedupes by post_id").

Below the table, **1–2 paragraphs of strategic insight** that interpret the asymmetries (volume vs. reach leaders, worst pro/anti ratio, who is silent, who is over-amplified relative to follower base). Table = what; paragraph = so what.

The stacked-bar widget on the dashboard ("Post Count by Entity") is the **visual anchor** for this section - reference it once, do not redescribe.

---

**Reference example (shape only).**

| Actor              | Posts | Reach     | SoV % | Sentiment (Pro / Anti) | Indicator |
| :----------------- | :---: | :-------: | :---: | :--------------------: | :-------: |
| `<Rival1>`         |  509  | 8,134,766 | 36.0% |        136 / 344       |     🟢    |
| `<Subject>`        |  362  | 4,641,794 | 20.5% |         85 / 249       |     🟢    |
| `<Rival2>`         |  266  | 2,167,018 |  9.6% |         46 / 204       |     🟡    |
| `<Rival3>`         |  217  | 1,767,492 |  7.8% |         59 / 132       |     🟡    |

*SoV% = share of total reach. Footnote: total reach = 22.6M (see §2). Counts UNION entity-match and stance-tagged posts; deduped by post_id.*

**Strategic insight.** `<Rival1>`'s reach lead is sustained almost entirely by a single `<Format>` mechanic (the gym video alone = 43% of his weekly reach), while his **pro:anti ratio of 1:2.5 is the worst in the field**. `<Subject>` consolidates the #2 position with a credible gap to #3 and a stable sentiment profile. The opposition is fractured: the four trailing actors together produce 20.7% SoV - *less than `<Subject>` alone*.
"""

SEC_6_MD = """<a id="sec-6"></a>
## §6 - Competitive positioning, per actor

**Agent instructions.** Every material actor in scope gets a sub-section. The inclusion bar is data-driven, not absolute: an actor clears it with either (a) ≥ 20 mentions via entity-match OR stance, OR (b) ≥ 100K reach in either signal. Cap is by the data, not by 3-or-4. If 8 actors clear, write 8 sub-sections; if 4 clear, write 4 (and a "minor actors" closing paragraph for the rest).

Each sub-section is **flowing prose** - typically 2–4 paragraphs, length follows what the data has to say. Not a bullet list, not a fill-in form. The reader should finish each sub-section with a feel for the actor's posture this period:

- Dominant narrative this week (in 1–3 words at the top of the sub-section, then expand).
- What they did well - cite the specific top posts inline (date, format, views, message, *why it worked*).
- Where they were weak.
- What they missed (the move the data shows they could have made but didn't).

Bold the asymmetric findings. A short embedded mini-table of the actor's top 2–3 posts is welcome where it earns its place; stacked bullet lists are not.

---

**Reference example (one sub-section - shape only).**

### `<Subject>` - *"initiative, under pressure"*

`<Subject>`'s week was structurally strong: the launch posted 1.27M views on the announcement alone, the formal merger created a coherent two-name brand without splitting reach, and `<Subject>` held the **#2 SoV position (20.5%)** with a stable sentiment profile (1:2.9 pro:anti) - better than every direct rival. The strongest tactical move was the 1.1M-view post on `<TopicA>`, which planted a hawkish signal and pre-empted `<RivalCamp>`'s "soft on `<TopicA>`" frame. **This is the post pattern to replicate**: short text, `<TopicA>`-anchored, morning window (07:30–09:00).

The weakness was **defensive posture against the "<AttackLine>"**. The libel-suit announcement scored well by its own measure (50K views, 8% engagement rate) but was 6× under-amplified vs. the aggregate attack (≈300K combined views across three accounts). The campaign treated it as a single legal item rather than a narrative arc to be **reframed**.

What `<Subject>` **missed**: the `<Rival2>` `<Event>` opening. 686K views of organic anger - `<Subject>` published zero posts using this story. Cost: an estimated 0.3–0.5M earned-reach equivalent on a converting frame.

*(Continue for every material actor in scope.)*
"""

SEC_7_MD = """<a id="sec-7"></a>
## §7 - Chronology: what shaped the week

**Agent instructions.** Three sub-sections. Numbers and dates here are the highest-risk surface for errors - build every cell from a single query result, not memory.

**7a. Day-by-day table.** One row per day in the requested period - **every day, even if the data is sparse**. Sparse days are signal, not noise; mark them `-` rather than dropping the row. Columns: `Date | Posts | Reach | Pro / Anti | Dominant emotion or one-line daily inflection`. Verify each row against the result set.

Query template:
```sql
SELECT
  DATE(posted_at) AS day,
  COUNT(*) AS posts,
  SUM(views) AS reach,
  COUNTIF(sentiment = 'positive') AS pro,
  COUNTIF(sentiment = 'negative') AS anti,
  APPROX_TOP_COUNT(emotion, 1)[OFFSET(0)].value AS dominant_emotion
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
GROUP BY day
ORDER BY day
```

Fill in missing days (the SQL won't return rows for zero-post days) by left-joining against a generated date series, OR by explicitly listing every day in the period and marking blanks as `-`.

**7b. Format / channel performance.** A compact table over the same period - rows are either platform × `content_type` (X-text, X-image, X-video, TikTok-video) **or** `channel_type` (Official / Media / UGC / Influencer); pick whichever cuts the data best - use one, not both. Columns: `n posts | total reach | avg reach/post | share of reach % | one-line takeaway`. Call out over- or under-performing formats relative to their volume.

**7c. Inflection points.** In prose, name the 2–3 days that **changed the shape of the period** and what drove them. Each inflection must cite the specific post(s) - date, time, platform, account, views - sourced from the data, not invented. Tie each spike to either a verified external event (web grounding) or a specific post. Do not leave it as "volume rose".

The line chart ("Daily Volume by Sentiment") on the dashboard is the visual anchor - reference it once, do not redescribe.

---

**Reference example (shape only).**

**7a - Day-by-day.**

| Date  | Posts | Reach | Pro / Anti | Daily inflection |
| :---- | ----: | ----: | :--------: | :--------------- |
| MM-DD |   391 |  4.1M |   95 / 130 | Launch - initiative |
| MM-DD |   368 |  3.4M |   82 / 121 | Foreign-policy signal; 1.1M post |
| MM-DD |   411 |  3.9M |   88 / 142 | `<Rival>` clip surfaces |
| MM-DD |    -  |   -   |     -      | (sparse - only N posts captured; cause: <reason or unknown>) |
"""

SEC_8A_MD = """<a id="sec-8a"></a>
## §8a - Subject deep dive: top posts, pro & anti

**Agent instructions.** Two sub-tables, each ranked by views (engagement as tie-breaker, or primary rank when views are unreliable - declare which once, in a footnote). Use **this exact column schema for both tables**:

| Date | Platform | Format | Account | Views | Likes | Message (1 line, original language) | Why it worked / landed | Replication template / Counter-move |

- **Top 5 pro-subject posts.** Last column = **replication template** (what the campaign should re-use next period).
- **Top 5 anti-subject posts.** Last column = **counter-move** (what to do about it next period).

The last column is what turns each table from observation into prescription. **Without it, you've described history.**

Query template (run twice - once per stance; if stance toward subject isn't separately enriched, fall back to overall post sentiment and note that explicitly in a footnote):
```sql
SELECT post_id, channel_handle, platform, content_type, posted_at, views, likes, content
FROM social_listening.scope_posts(@agent_id)
WHERE EXISTS (SELECT 1 FROM UNNEST(entities) e WHERE LOWER(e) IN UNNEST(@subject_variants))
  AND sentiment = @stance       -- 'positive' or 'negative'
  AND posted_at BETWEEN @period_start AND @period_end
ORDER BY views DESC
LIMIT 5
```

---

**Reference example (one row per table - shape only).**

**Top pro-subject posts (excerpt).**

| Date  | Platform | Format | Account     | Views | Likes | Message                                | Why it worked                          | Replication template                            |
| :---- | :------: | :----: | :---------- | ----: | ----: | :------------------------------------- | :------------------------------------- | :---------------------------------------------- |
| MM-DD |    X     |  text  | @<subject>  | 1.27M | 38K  | "<one-line message, original language>" | Coherent two-name brand; clean stake | Morning post (07–09), foreign-policy or coalition anchor |

**Top anti-subject posts (excerpt).**

| Date  | Platform | Format | Account     | Views | Likes | Message                                | Weakness exposed                       | Counter-move                                    |
| :---- | :------: | :----: | :---------- | ----: | ----: | :------------------------------------- | :------------------------------------- | :---------------------------------------------- |
| MM-DD |    X     |  text  | @<rival>    |  302K |  3.3K | "<attack message>"                     | `<Rival>`'s reach floor is structural   | Avoid direct reply; pivot to `<TopicA>`         |
"""

SEC_8B_MD = """<a id="sec-8b"></a>
## §8b - Tone & emotion correlation on subject's own content

**Agent instructions.** When `emotion` enrichment is available, count which emotions on the **subject's own** content correlate with strong performance, and which under-perform. Average reach/post per emotion is the right cut. State the implication for tone and framing next period.

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

**If emotion enrichment is unavailable, REMOVE this widget** (`update_dashboard(layout_id, removals=["<this-widget-i>"])`). Do NOT fabricate emotion analysis. Note the removal in §App-B (data gaps).

---

**Reference example (shape only).**

| Emotion        | Posts | Avg Reach/Post | Total Reach | Implication                          |
| :------------- | ----: | -------------: | ----------: | :----------------------------------- |
| trust          |    14 |         92,000 |       1.29M | High-performing tone - keep cadence |
| anger          |     7 |         18,000 |        126K | Under-performs vs. trust; pull back |
| excitement     |     5 |         71,000 |        355K | Strong on launch posts only         |

**Implication.** The subject's reach is concentrated in *trust-anchored* posts. Anger-tagged content under-performs by 5×. Recommendation: anger-tagged posts only when the news cycle demands them, not as a default tone.
"""

SEC_8C_MD = """<a id="sec-8c"></a>
## §8c - Custom-field deep dive (stance, sentiment-toward-subject, etc.)

**Agent instructions.** The agent's enrichment schema (`custom_fields`) carries client-specific axes (e.g. `candidate_stance`, `<merger>_sentiment`, `<topic>_position`). Surface the most informative `custom:<field>` distribution that the user's framing implies. Build a compact table: `value | posts | avg reach | sentiment skew`. Discover candidate fields by sampling `custom_fields` on `scope_posts`; pick the field that best discriminates against the framing question.

This is also the place to **reconcile entity-match vs. stance counts** when the two signals diverge for the subject. If §5 shows 4 mentions via exact match but stance tagging shows 173 posts, say so here in one line - name the gap and which signal §5 used.

Query template:
```sql
SELECT
  JSON_EXTRACT_SCALAR(custom_fields, '$.<field>') AS value,
  COUNT(*) AS posts,
  SUM(views) AS total_reach,
  COUNTIF(sentiment='positive') AS pro,
  COUNTIF(sentiment='negative') AS anti
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
  AND JSON_EXTRACT_SCALAR(custom_fields, '$.<field>') IS NOT NULL
GROUP BY value
ORDER BY posts DESC
```

If no custom fields are configured for this agent, **REMOVE this widget** (don't write hand-wavy stance prose without data).

---

**Reference example (shape only).**

| Stance              | Posts | Avg Reach/Post | Pro / Anti |
| :------------------ | ----: | -------------: | :--------- |
| pro_<subject>       |    70 |       14,958   |  56 / 12   |
| anti_<subject>      |   103 |        5,685   |   0 / 103  |
| pro_<rival>         |   109 |       35,356   |  88 / 17   |
| anti_<rival>        |   264 |       11,131   |   1 / 263  |

**Reconciliation.** §5 shows 4 entity-match mentions for `<Subject>`; this stance distribution shows 173 posts (70 pro + 103 anti). The gap is the wide-vs-narrow signal split - §5 used the UNION; §8c here shows the stance breakdown alone for narrative depth.
"""

SEC_8D_MD = """<a id="sec-8d"></a>
## §8d - What was missed

**Agent instructions.** A candid list of opportunities the subject did **not** capitalize on. Each item names:
- The specific opportunity (with date and one-line description).
- The cost (lost reach, ceded narrative ground, missed news cycle - quantified).
- Why it matters strategically - not just descriptively.

This sub-section is what separates an analyst from a clipping service. **Do not soften.** If the campaign missed something, say so plainly and price it.

---

**Reference example (shape only).**

- **`<Rival2>` `<Event>` (MM-DD).** 686K views of organic anger at `<the-trigger>`. `<Subject>` owns the "responsible `<Wing>`" frame more than any rival; the campaign published zero posts using this story. **Cost: ≈0.3–0.5M earned-reach on a converting frame.**
- **`<Rival3>` `<Controversy>` (MM-DD → MM-DD).** 204 anti-`<Rival3>` posts, average 5.4K reach; `<Subject>` did not link economic record vs. `<Rival3>`'s. **Cost: ceded "competent `<Wing>`" ground.**
"""

SEC_9_MD = """<a id="sec-9"></a>
## §9 - Narratives, clusters, and hashtags

**Agent instructions.** A table of live narrative clusters covering the period. Use `list_topics` to pull semantic clusters - reference **at least 5–10 by name** in the narrative below. Schema:

| Cluster | Post count | Lead voices (handles) | Status | Recommended response |

- **Status:** `emerging` / `sustained` / `fading` / `dangerous`.
- **Lead voices:** specific handles, not vague descriptions.
- **Recommended response:** operational, single line.

Track **branded-hashtag adoption** explicitly. If the campaign's own hashtag has 0 appearances in 1,000+ posts, that's a finding, not a footnote.

**Cross-platform call-out (load-bearing).** Where narrative shape diverges between platforms (often the same actor reads completely different on each), flag it explicitly. This is one of the highest-value insights this report produces.

The word-cloud on the dashboard is the visual anchor - reference it once.

---

**Reference example (shape only).**

| Cluster                            | Posts | Lead voices                          | Status     | Recommended response                |
| :--------------------------------- | ----: | :----------------------------------- | :--------- | :---------------------------------- |
| `<Subject>` mental fitness         |    78 | @rival1, @rival_outlet, @rival_inf    | dangerous  | Reframe as `<RivalCamp>`-panic offensive |
| Coalition launch + merger          |   142 | @subject, @ally1, allies              | sustained  | Continue 1/day cadence first 3 weeks |
| `<Rival2>` `<Event>`               |    66 | @<news1>, @<news2>, @<news3>          | fading     | **Reactivate within 48h via "responsible `<Wing>`" frame** |

**Cross-platform note.** The launch reads as **coalition / strategy** on X (high pro/anti ratio, policy-flavored discussion) but reads as **personality / character** on TikTok (heavy anti-subject emotional content). Narrative tools must be platform-specific.

**Branded-hashtag adoption.** Campaign hashtag `<#TAG>` appears in 89 posts (3.6% of corpus) - under-adopted for a launch week. Compare: rival hashtag `<#RIVAL_TAG>` appears in 142 posts.
"""

SEC_10_MD = """<a id="sec-10"></a>
## §10 - Platform comparison

**Agent instructions.** When the data spans multiple platforms, an explicit comparison. Schema:

| Platform | Post share % | Reach share % | Pro % | Anti % | Audience implication |

Below the table, 1 paragraph naming the asymmetry and what it implies *strategically* - not descriptively. The Sentiment Mix doughnut and Platform Mix bar on the dashboard are the visual anchors.

If the corpus is single-platform, REMOVE this widget rather than writing "n/a" prose.

---

**Reference example (shape only).**

| Platform | Post share % | Reach share % | Pro % | Anti % | Audience implication |
| :------- | -----------: | ------------: | ----: | -----: | :------------------- |
| Twitter (X) |       71.2% |         62.5% | 34.1% |  41.2% | Older, news-reading, party-aligned; debate-heavy |
| TikTok     |       28.8% |         37.5% | 22.8% |  51.4% | Younger, virality-driven; **higher anti-incumbent skew** |

**Strategic asymmetry.** TikTok carries 1.3× its post-share in reach but **+10 pts more anti-** sentiment than X. For `<Subject>`, the platform that grows fastest is also where they're most vulnerable to character attacks. Reach growth on TikTok without tone-correction risks net-negative results. The format prescription: short personal-narrative video, not policy posts, in the 18:00–22:00 window where the demographic shifts younger.
"""

SEC_11_MD = """<a id="sec-11"></a>
## §11 - Channels & amplifiers

**Agent instructions.** Three blocks. The Top Channels widget on the dashboard is the data source - *interpret* it, do not re-table it. Reference the actual top handles by name (look them up via `execute_sql` if needed).

**11a. Top channels.** Reference the widget's top 10 channels by handle. In 1 paragraph: which are official, which are media, which are UGC; which are over-amplifying the subject; which are over-amplifying rivals.

**11b. Subject's owned-channel performance.** Compact markdown table of the subject's own channels across platforms:

| Channel | Platform | Posts | Avg reach/post | Avg engagement rate | Best post |

This table must have ≥2 rows if the subject has more than one channel. A one-row table is not a table - if there's only one channel, write a paragraph instead.

**11c. Missed amplification opportunities.** UGC accounts or media outlets that consistently amplify *adjacent* messaging but did NOT amplify the subject this week. List 3–5 with handles + the post they should have amplified but didn't. Verify the handle's prior alignment via `execute_sql` (look at their last 30 days of stance / sentiment toward the subject).

---

**Reference example (shape only).**

| Channel             | Platform | Posts | Avg reach/post | Engagement rate | Best post |
| :------------------ | :------: | ----: | -------------: | --------------: | :-------- |
| @subject_main       |    X     |    12 |        342K   |          4.8%   | MM-DD launch (1.27M) |
| @subject_movement   |    X     |     8 |         98K   |          3.1%   | MM-DD `<topic>` post (1.1M) |
| @subject_tiktok     | TikTok   |    14 |        128K   |          5.7%   | MM-DD family content (520K) |
"""

SEC_12_MD = """<a id="sec-12"></a>
## §12 - Audience insights

**Agent instructions.** Who is actually doing the talking. Three to four short paragraphs covering:

- **Dominant cohorts** (age band, region, language, platform skew where the data supports it).
- **Named influencer accounts** with handles - not "various influencers".
- **Audience overlap with adjacent actors** - when commenters under subject posts also engage with rival accounts. **Quantify the overlap** (e.g., "41% of accounts commenting on the subject's launch also commented on `<Rival>` content within the prior 14 days"). When two cohorts overlap unexpectedly, *that* is the finding.
- **Persuasion targets vs. lost causes.** Who is gettable, who is not, with one line each.

If demographic enrichment isn't available, replace the demographic claim with what *is* observable: handle patterns, follower-count distributions, time-of-engagement patterns. Do not fabricate cohort descriptions.

---

**Reference example (shape only).**

The dominant pro-`<Subject>` cohort on X is **center-`<wing>` adults 35–55**, identifiable by handle patterns (heavy concentration of `<patternA>`, military-rank prefixes, and reservist-flagged bios). Engagement clusters in the 07:00–10:00 window - workday morning, consistent with a working professional base. On TikTok the pro-`<Subject>` audience is materially younger and **smaller** - average post engagement < 1/4 of the X analog.

The **load-bearing audience-overlap finding**: 41% of accounts commenting on the subject's launch post also commented on `<Rival3>` launch content within the prior 14 days. This is a **persuasion-target zone**, not loyalty - these voters are shopping for an alternative and the data shows `<Rival3>` is a real competitor.

**Lost causes:** the anti-`<Subject>` TikTok cohort engaging with the "<AttackLine>" line shows near-zero crossover into pro-`<Subject>` content (3% overlap). Do not spend energy here.
"""

SEC_13_MD = """<a id="sec-13"></a>
## §13 - Risks & opportunities

**Agent instructions.** Two compact tables. Operational, not philosophical. Each row names a specific item, not a category.

**Risks table:**

| Risk | Area | Urgency | Recommended action |
| :--- | :--- | :------ | :----------------- |

- Urgency: `critical` / `high` / `medium` / `low`. Use sparingly - not everything is critical.

**Opportunities table:**

| Opportunity | Size (est.) | Time window | Recommended next move |
| :---------- | :---------- | :---------- | :-------------------- |

- Size: a number or reach band, not "big".
- Time window: a date range, not "soon".

---

**Reference example (shape only).**

**Risks.**

| Risk | Area | Urgency | Recommended action |
| :--- | :--- | :------ | :----------------- |
| "<AttackLine>" consolidates into `<RivalCamp>` doctrine | Defensive - character | **critical** | Counter-narrative arc launch within 72h; see §14.1 |
| TikTok anti-skew compounds with no `<Subject>` TikTok answer | Defensive - platform | high | Daily on-camera TikTok 18:00–22:00 |

**Opportunities.**

| Opportunity | Size (est.) | Time window | Recommended next move |
| :---------- | :---------- | :---------- | :-------------------- |
| `<Rival2>` `<Event>` - "responsible `<Wing>`" reframe | 0.3–0.5M earned reach | 48h | Split-screen video; see §14.2 |
"""

SEC_14_INTRO_MD = """<a id="sec-14"></a>
## §14 - Operational recommendations - detailed

**Agent instructions for §14 overall.** The long form of the 5 recommendations from §4. Each lives in its own sub-section widget below (§14.1 through §14.5). If §4 lists fewer than 5 recommendations, REMOVE the unused sub-section widgets via `update_dashboard(layout_id, removals=[...])`. Do **not** leave empty placeholders.

Required content per recommendation:

1. **Quantitative justification** - the specific finding from this report that motivates it (cite by section number).
2. **Execution plan** - a calendar table where applicable: `| Day | Time | Channel | Format | Template |`.
3. **Specific accounts / formats / times** to target.
4. **Success KPI** - what measurement will tell you if it worked, and the threshold.

Generic recommendations ("increase engagement", "use more video") are a tell that the analysis was thin. **Cut anything that doesn't pass the specificity test.**
"""

SEC_14_X_MD_TEMPLATE = """<a id="sec-14-{n}"></a>
### §14.{n} - `<Recommendation headline matching §4 item {n}>`

**Agent instructions.** Expand the §4 headline recommendation #{n} into a full operational plan. If §4 has fewer than {n} recommendations, REMOVE this widget (`update_dashboard(layout_id, removals=["<this-widget-i>"])`) rather than filling with placeholder content.

Required structure:
- **Justification (cite §X, §Y, …).** The specific finding from earlier sections that motivates this recommendation.
- **Execution plan** - calendar table with Day / Time / Channel / Format / Template columns. Time windows must be specific (e.g. "09:00–09:30"), not vague ("morning").
- **Target accounts for amplification.** Named handles, with one-line "why this account".
- **Success KPI.** Specific threshold and time window - e.g., "≥600K cumulative reach within 72h; sentiment shift from 2.1 : 1 (pro) to ≥4 : 1".

---

**Reference example (shape only).**

**Justification (§4, §5, §9, §13).** Three pro-`<RivalCamp>` posts (combined 308K views) carried the "<AttackLine>". `<Subject>`'s libel-suit response (50K views) is 6× under-amplified. The campaign treated the attack legally but not narratively - leaving the framing in `<RivalCamp>` hands. Cluster `<Subject> mental fitness` is flagged `dangerous` in §9.

**Execution plan - 72h cadence.**

| Day  | Time  | Channel             | Format            | Template |
| :--- | :---: | :------------------ | :---------------- | :------- |
| Day 1 | 08:00 | @<subject> (X) | text thread (4 posts) | "Three falsehoods, three corrections" |
| Day 1 | 19:00 | @<subject>_movement (X) + 4 aligned influencers | quote-card image | Side-by-side comparison |
| Day 2 | 09:00 | @<subject>_tiktok | 45s video | On-camera response monologue, no studio set |

**Target accounts for amplification:** @ally1, @ally2, @ally3 - confirmed aligned center-`<wing>` (§11c).

**Success KPI.** Cumulative reach across the response content ≥ 600K within 72h (2× the original attack). Sentiment ratio on the libel-suit narrative shifts from current 2.1 : 1 (pro) to ≥ 4 : 1.
"""

APP_A_MD = """<a id="sec-app-a"></a>
## Appendix A - External context (web grounding)

**Agent instructions (MANDATORY, ≥5 sources WITH LINKS).** Polls, press articles, web research, market data, third-party reports that ground the analysis. Use **web grounding** to pull current sources. **Every entry must include a working URL.** Group by type when there are enough (polls / press / market / official / regulatory).

For each source: a one-line summary, a link (markdown `[label](url)`), and **the specific data signal in this report it grounds** (cite the section). A source that doesn't connect to a body finding doesn't earn its place.

If the data corpus has anomalies (volume spikes, sentiment cliffs, sudden hashtag emergence) that aren't tied to an external event in this appendix, that's a hole in the analysis - fill it. Run web grounding for each inflection point in §7c.

**No web grounding ran in this session?** That's a defect, not a permissible state. Run it before publishing.

---

**Reference example (shape only - agent generates current week's actual citations with real URLs).**

### Polls

- **[<Outlet> - <Pollster> poll (YYYY-MM-DD)](https://example.com/poll-link).** `<Subject>` bloc projected at 36 seats vs. `<Rival1>` 27. **Grounds §4 finding** that the bloc has consolidated a credible lead.
- **[<Outlet2> - <Pollster2> poll (YYYY-MM-DD)](https://example.com/poll-link2).** Same week, narrower 32–28 gap; both polls reported high `<Subject>` favorability among `<RivalCamp>`-defector cohort.

### Press

- **[<Outlet> (YYYY-MM-DD) - "<Headline>"](https://example.com/article).** Coverage of the launch; **grounds §7c inflection MM-DD**.
- **[<Outlet2> (YYYY-MM-DD) - "<Headline2>"](https://example.com/article2).** Detailed coverage of the attack line; **grounds §9 cluster `<cluster name>`**.

### Market / context

- **[<Institution> - <Report name> (YYYY-Q2)](https://example.com/report).** 31% trust in `<institution>`; **grounds §12 audience-cohort claim** that the anti-incumbent skew is structural, not week-specific.
"""

APP_B_MD = """<a id="sec-app-b"></a>
## Appendix B - Methodology & sources

**Agent instructions.** Transparent about what the data does and does not cover. One short paragraph + a structured list.

Required fields:

- **Data scope** - agent ID, total source-collection IDs (count + listing or link to a long list).
- **Period** - exact start and end timestamps.
- **Corpus** - total posts (raw / after dedup), platform mix, language mix.
- **Classification taxonomy** - sentiment categories used, stance values, topic-cluster count from `list_topics`, emotion categories.
- **Tools used in this run** - `entity_metrics`, `execute_sql` queries, `list_topics` calls, web-grounding queries.
- **External sources consulted** - count, with link to Appendix A for the full list.
- **Data-quality scoreboard (required).** A small table showing per-field non-null coverage on the period's corpus:

| Field | Non-null % | Notes |
| :---- | ---------: | :---- |
| sentiment | 98.4% | Standard 3-class |
| emotion | 92.1% | 7 categories |
| entities | 76.3% | Exact-name extraction; ⚠ narrow signal - see §5 reconciliation |
| custom_fields.<field1> | 88.7% | Stance enrichment |
| custom_fields.<field2> | 41.2% | Sparse - interpret cautiously |
| themes | 95.5% | |
| post embedding | 100% | |

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

- **Known data gaps** - platforms missing, periods sparse, voices absent, enrichment fields not populated. Be specific: "TikTok comment depth limited to top 100 per post (provider cap)", "Stance toward subject not separately enriched - fell back to overall post sentiment", etc.

**Confident silence beats false synthesis.** If a finding upstream was hedged because of a data gap, name the gap here.
"""


# ─── Chart widgets - copy verbatim from v1 ──────────────────────────────────


def _chart_widgets() -> list[dict]:
    """Re-create the v1 chart widgets exactly. Positions (x/y) are
    reassigned later by `build_layout`."""
    return [
        # 4 KPI cards (3-wide each, 1 row)
        {"i": "9663d3d12f", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 0, "w": 3, "h": 2, "title": "Total Posts"},
        {"i": "98546895ea", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 1, "w": 3, "h": 2, "title": "Total Reach"},
        {"i": "202cd25b9f", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 2, "w": 3, "h": 2, "title": "Total Engagement"},
        {"i": "bcd59c22e8", "chartType": "number-card", "aggregation": "kpi",
         "kpiIndex": 3, "w": 3, "h": 2, "title": "Engagement Rate"},
        # Entity stacked bar
        {"i": "13246f5607", "chartType": "bar", "aggregation": "custom",
         "w": 10, "h": 8, "title": "Post Count by Entity (sentiment mix)",
         "figureText": "Share of voice across material actors, split by post sentiment. Use as the visual anchor for §6.",
         "customConfig": {
            "topN": 12, "includeOthers": False, "dimension": "entities",
            "metric": "post_count", "breakdownDimension": "sentiment",
            "barOrientation": "horizontal", "stacked": True}},
        # Daily volume line
        {"i": "ae7bfdcab8", "chartType": "line", "aggregation": "custom",
         "w": 10, "h": 6, "title": "Daily Volume by Sentiment",
         "figureText": "Day-by-day post count, broken down by sentiment. Pair with the chronology table in §7.",
         "customConfig": {
            "timeBucket": "day", "dimension": "posted_at", "metric": "post_count",
            "metricToggle": ["post_count", "view_count"],
            "breakdownDimension": "sentiment"}},
        # Theme cloud
        {"i": "fa75ec9fdb", "chartType": "word-cloud", "aggregation": "theme-cloud",
         "w": 10, "h": 7, "title": "Theme Cloud",
         "figureText": "Qualitative landscape of themes across the corpus. Use as visual anchor for §9 (Narratives)."},
        # Sentiment doughnut
        {"i": "102d4ef2b1", "chartType": "doughnut", "aggregation": "sentiment",
         "w": 5, "h": 6, "title": "Sentiment Mix"},
        # Platform bar
        {"i": "6f616f581a", "chartType": "bar", "aggregation": "platform",
         "w": 5, "h": 6, "title": "Platform Mix"},
        # Top channels table
        {"i": "bad3e8fbe0", "chartType": "table", "aggregation": "channels",
         "w": 10, "h": 8, "title": "Top Channels",
         "figureText": "Top amplifying channels by post count, with average reach and engagement. Pair with §11 narrative.",
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


def _text(i: str, md: str, w: int = 12, h: int | None = None) -> dict:
    """Build a text widget. h defaults to 1 per ~150 chars of markdown
    (rough heuristic). Caller can override."""
    if h is None:
        h = max(4, len(md) // 200 + 2)
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
    """Build the full v2 layout - text widgets + chart widgets - with x/y
    positions resolved by a simple top-down vertical packer (since
    orientation='vertical')."""
    charts = {w["i"]: w for w in _chart_widgets()}

    # Linear order of widgets in the dashboard (top to bottom).
    # Widget IDs are stable hex10 strings so re-running this script is idempotent
    # and any agent that has previously seen the template still finds the same `i`s.
    seq: list[dict] = [
        _text("95de6586ff", HEADER_MD, h=3),
        _text("v2sec02met", SEC_2_MD, h=10),
        _text("f17c474a23", SEC_3_MD, h=10),
        # 4 KPI cards on one row
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        _text("1065122493", SEC_4_MD, h=16),
        _text("8ad4890af0", SEC_5_MD, h=18),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("611023f3c7", SEC_6_MD, h=14),
        _text("9f7a6f5a80", SEC_7_MD, h=14),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("v2sec08a00", SEC_8A_MD, h=16),
        _text("v2sec08b00", SEC_8B_MD, h=10),
        _text("v2sec08c00", SEC_8C_MD, h=12),
        _text("v2sec08d00", SEC_8D_MD, h=8),
        _text("44e6ff15a4", SEC_9_MD, h=14),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("9933cd9482", SEC_10_MD, h=10),
        # Sentiment + Platform side by side
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        _text("bc0350f537", SEC_11_MD, h=12),
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("ed747f8a17", SEC_12_MD, h=10),
        _text("80793eb294", SEC_13_MD, h=10),
        _text("v2sec14int", SEC_14_INTRO_MD, h=6),
        _text("v2sec14r01", SEC_14_X_MD_TEMPLATE.format(n=1), h=14),
        _text("v2sec14r02", SEC_14_X_MD_TEMPLATE.format(n=2), h=14),
        _text("v2sec14r03", SEC_14_X_MD_TEMPLATE.format(n=3), h=14),
        _text("v2sec14r04", SEC_14_X_MD_TEMPLATE.format(n=4), h=14),
        _text("v2sec14r05", SEC_14_X_MD_TEMPLATE.format(n=5), h=14),
        _text("753c5f3e61", APP_A_MD, h=12),
        _text("cfd2c21ccd", APP_B_MD, h=14),
    ]

    # Vertical packer. Most widgets are full-width (12). Charts marked
    # x_inset=True are width 10, x=1 (centered with 1-col margin). The
    # sentiment + platform pair is a special two-up row at y=fixed.
    out: list[dict] = []
    y = 0
    i = 0
    while i < len(seq):
        w = seq[i]
        # Two-up row: doughnut + platform bar side-by-side.
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
        # Inset chart (width 10, x=1).
        if w.pop("x_inset", False):
            w = {**w, "x": 1, "y": y}
            out.append(w)
            y += w["h"]
            i += 1
            continue
        # KPI cards row: 4 number-cards back-to-back at the same y.
        if w.get("aggregation") == "kpi" and i + 3 < len(seq) \
                and all(seq[i + j].get("aggregation") == "kpi" for j in range(4)):
            for k, off in enumerate([0, 3, 6, 9]):
                kw = {**seq[i + k], "x": off, "y": y, "w": 3, "h": 2}
                out.append(kw)
            y += 2
            i += 4
            continue
        # Default: full-width row.
        w_ = {**w, "x": 0, "y": y, "w": w.get("w", 12)}
        out.append(w_)
        y += w_["h"]
        i += 1
    return out


def write_template(dry_run: bool) -> None:
    layout = build_layout()
    title = "Weekly Competitive Brand Report (Template v2)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"v2 layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN - not writing to Firestore.")
        print(f"\nFirst widget: {layout[0]}")
        print(f"Last widget: {layout[-1]}")
        return

    fs = get_fs()
    db = fs._db

    # Write dashboard_layouts doc.
    db.collection("dashboard_layouts").document(V2_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V2_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    # Write explorer_layouts doc so the user sees it in the dropdown.
    now_iso = "2026-05-13T13:00:00+00:00"
    db.collection("explorer_layouts").document(V2_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    # Stamp v1 with is_template=true for safety (existing reports already
    # cloned from v1; we leave them alone, but mark the source so future
    # tooling refuses to mutate it).
    db.collection("dashboard_layouts").document(V1_TEMPLATE_ID).update({
        "is_template": True,
    })

    print(f"\nWrote v2 template: dashboard_layouts/{V2_TEMPLATE_ID}")
    print(f"Wrote v2 explorer entry: explorer_layouts/{V2_TEMPLATE_ID}")
    print(f"Stamped v1 with is_template=true: dashboard_layouts/{V1_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Build the layout and print stats; don't write to Firestore.")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
