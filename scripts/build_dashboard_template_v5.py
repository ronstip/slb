"""Build the v5 weekly competitive brand report template.

Targeted brief changes from v3 (response to the Bennett-week audit):

  §5  Share of Voice
      - Indicator column switches from 🟢 / 🟡 / 🔴 to ▲ / ▬ / ▼ tied to a
        FIXED threshold on `net_sentiment` from the entity_metrics TVF
        (▲ > +0.10, ▬ between −0.10 and +0.10, ▼ < −0.10). Removes the
        prior "agent picks the convention" ambiguity.
      - SoV % comes from `sov_views` returned by the TVF - NOT re-normalized
        by summing the rows. Sums >100% are expected (posts mention multiple
        actors) and must be footnoted with the actual overlap %.
      - One-line legend printed below the table is mandatory.

  §7c Inflection points
      - Every "X drove the spike on date Y" claim must be cross-checked with
        a per-day × per-platform (or per-day × per-entity) query before
        being pasted. State the cross-check inline.

  §8c Stance distribution
      - `custom_fields` keys (e.g. `pro_bibi`, `anti_bennett`) must be
        translated to human-readable labels in the data's language. Raw
        snake_case keys are forbidden in the table.

  §14 intro
      - Collapsed from a meta-section full of agent instructions into a
        short one-paragraph orientation that the agent fills with concrete
        content. The instruction block is moved to a comment inside the
        brief so the agent doesn't accidentally ship it.

All other briefs and chart configs imported verbatim from v3.

Usage:
    uv run python scripts/build_dashboard_template_v5.py [--dry-run]
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
    HEADER_MD, SEC_2_MD, SEC_3_MD, SEC_4_MD,
    SEC_6_MD, SEC_8A_MD, SEC_8B_MD, SEC_8D_MD,
    SEC_9_MD, SEC_10_MD, SEC_11_MD, SEC_12_MD, SEC_13_MD,
    SEC_14_X_MD_TEMPLATE, APPENDIX_MD,
    _chart_widgets,
)
from api.deps import get_fs  # noqa: E402

V5_TEMPLATE_ID = "d5b1c8e9f4a72e3c6b8d5a9e1c7f0b42"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


# ─── Briefs that differ from v3 ─────────────────────────────────────────────

SEC_5_MD = f"""<a id="sec-5"></a>
## 5. Share of Voice & KPI dashboard

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Build one row per material actor. **Rank by reach.** Use this exact column schema (no extra columns, no dropped columns):

| Actor | Posts | Reach | SoV % | Sentiment (Pro / Anti) | Tone |

- **Posts**: count of in-scope posts by or about the actor (UNION of entity-match and stance signals, deduped by `post_id`).
- **Reach**: sum of views over the deduped post set.
- **SoV %**: copy `sov_views` from the `entity_metrics` TVF row, formatted as a percent. **Do NOT re-normalize across the rows of this table.** The TVF computes SoV against the full corpus reach. If the SoVs sum to >100%, that is the expected overlap signal - footnote it with the actual overlap rate (see "Overlap footnote" below).
- **Sentiment (Pro / Anti)**: `<pro count> / <anti count>`.
- **Tone**: ONE arrow glyph from the TVF's `net_sentiment` field:
  - ▲ - `net_sentiment > +0.10` (clearly positive net tone)
  - ▬ - `−0.10 ≤ net_sentiment ≤ +0.10` (contested / mixed)
  - ▼ - `net_sentiment < −0.10` (clearly negative net tone)
  Apply the threshold uniformly; do not pick the glyph by impression.

**Legend (print immediately below the table - one line):**
> *Tone column: ▲ net-positive tone, ▬ mixed, ▼ net-negative. Threshold ±0.10 on `(pro − anti) / mentions`. SoV % is share of total corpus reach; rows can sum to >100% when posts mention multiple actors (overlap footnoted below).*

**Overlap footnote (mandatory).** One line stating the actual overlap rate, computed as:

```sql
SELECT ROUND(100 * SUM(CASE WHEN ARRAY_LENGTH(entities) > 1 THEN 1 ELSE 0 END) / COUNT(*), 1)
       AS multi_actor_post_pct
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at BETWEEN @period_start AND @period_end
```

**Data sources - two-signal UNION (load-bearing).** Build §5 from a UNION of two signals, presented in ONE table (not split across sections):
- `social_listening.entity_metrics(...)` - exact-string match on `entities`. Read `sov_views`, `net_sentiment`, `pos_mentions`, `neg_mentions`, `total_views`, `mentions` straight from the row. Do not derive them.
- `custom_fields.candidate_stance` - stance-tagged posts that mention the actor implicitly.

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

| Actor              | Posts | Reach     | SoV % | Sentiment (Pro / Anti) | Tone |
| :----------------- | :---: | :-------: | :---: | :--------------------: | :--: |
| `<Rival1>`         |  509  | 8,134,766 | 36.0% |        136 / 344       |   ▼  |
| `<Subject>`        |  362  | 4,641,794 | 20.5% |         85 / 249       |   ▼  |
| `<Rival2>`         |  266  | 2,167,018 |  9.6% |         46 / 204       |   ▼  |
| `<Rival3>`         |  217  | 1,767,492 |  7.8% |         59 / 132       |   ▬  |

*Tone column: ▲ net-positive tone, ▬ mixed, ▼ net-negative. Threshold ±0.10 on `(pro − anti) / mentions`. SoV % is share of total corpus reach; rows can sum to >100% when posts mention multiple actors (overlap footnoted below).*

*Multi-actor posts: 28.4% of in-scope posts mention two or more actors - explains the >100% row sum.*

**Strategic insight.** `<Rival1>`'s reach lead rests on a single viral mechanic (one `<Format>` item = 43% of his weekly reach); his **pro:anti ratio is the most negative in the field**. `<Subject>` holds a clean #2 with a stable sentiment profile and a credible gap to #3. The four trailing actors together produce 20.7% SoV - *less than `<Subject>` alone*.
"""


SEC_7_MD = f"""<a id="sec-7"></a>
## 7. Chronology - what shaped the week

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Three sub-sections. Numbers and dates here are the highest-risk surface for errors - build every cell from a single query result, not memory. Sub-section headers use `###` (not `##`).

**7a. Day-by-day table.** One row per day in the requested period - **every day, even if the data is sparse**. Sparse days are signal, not noise; mark them `-` rather than dropping the row.

| Date | Posts | Reach | Pro / Anti | Dominant emotion / one-line daily inflection |

Fill missing days by left-joining against a generated date series, OR by explicitly listing every day in the period and marking blanks as `-`.

**7b. Format / channel performance.** A compact table over the same period. Rows are either platform × `content_type` (X-text, X-image, X-video, TikTok-video) **OR** `channel_type` (Official / Media / UGC / Influencer); pick whichever cuts the data best - one, not both.

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |

Call out over- or under-performing formats relative to their volume.

**7c. Inflection points.** In prose, name the 2–3 days that **changed the shape of the period** and what drove them. Each inflection cites specific post(s) - date, time, platform, account, views - sourced from the data. Tie each spike to either a verified external event (web grounding) or a specific post. Do not leave it as "volume rose".

**Cross-check rule (load-bearing).** Every claim of the form *"X drove the spike on day Y"* MUST be cross-checked with one targeted query before being pasted. Run a per-day × per-platform OR per-day × per-entity slice for that date:

```sql
-- e.g. did TikTok actually drive Day-N's reach?
SELECT platform, COUNT(*) AS posts, SUM(views) AS reach
FROM social_listening.scope_posts(@agent_id)
WHERE DATE(posted_at) = DATE '<Y>'
GROUP BY platform
ORDER BY reach DESC
```

If the platform/entity you blamed contributes <30% of the day's reach, the claim is wrong - rewrite or drop it. State the cross-check inline (e.g. "*Cross-check: TikTok contributed 1.4% of Day-N's 7.5M reach; X carried the spike.*").

Reference the daily-volume line chart on the dashboard once.

---

**Reference example.**

**7a. Day-by-day.**

| Date  | Posts | Reach | Pro / Anti | Daily inflection |
| :---- | ----: | ----: | :--------: | :--------------- |
| MM-DD |   391 |  4.1M |   95 / 130 | Launch - initiative |
| MM-DD |   368 |  3.4M |   82 / 121 | Foreign-policy signal; 1.1M post |
| MM-DD |    -  |   -   |     -      | (sparse - only N posts; cause: <reason>) |

**7b. Format / channel performance.**

| Cut | Posts | Total reach | Avg reach / post | Share of reach % | Takeaway |
| :--- | ----: | ----------: | ---------------: | ---------------: | :------- |
| X - official statements | 12 | 1.55M | 129K | 10.5% | Few posts, huge per-post weight |
| X - text commentary     | 482 | 2.58M | 5.4K |  17.5% | Workhorse format for argumentation |
| TikTok - opinion video  |  17 | 434K  | 25K  |   2.9% | Punches above its volume |

**7c. Inflection points.**

- **MM-DD: launch.** Announcement post (1.27M views, @<subject>) sets the week's frame; pro reach +312% vs. baseline. *Cross-check: @<subject> contributed 31% of Day-N's reach; the rest split across 4 amplifying handles.*
- **MM-DD: counter-attack lands.** Three pro-`<RivalCamp>` posts ([302K](https://x.com/...), [180K](https://x.com/...), [110K](https://x.com/...)) carry the "<AttackLine>" frame; `<Subject>`'s response under-amplified 6×. *Cross-check: X carried 94% of Day-N's reach; TikTok contributed <2%.*
"""


SEC_8C_MD = f"""<a id="sec-8c"></a>
## 8c. Stance distribution (custom fields)

{VOICE}

{BODY_SKELETON}

**Agent instructions.** Surface the most informative `custom_fields.<field>` distribution given the user's framing (e.g. `candidate_stance`, `<merger>_sentiment`, `<topic>_position`). Discover candidate fields by sampling `custom_fields`; pick the field that best discriminates against the framing question.

Use this table schema:

| Stance | Posts | Avg Reach / Post | Sentiment (Pro / Anti) |

**Label translation (load-bearing).** Raw `custom_fields` keys are snake_case English (`pro_bibi`, `anti_bennett`, `pro_ben_gvir`, …). **Translate every label to a human-readable phrase in the data's dominant language** before writing the table. The raw key never appears in a customer-facing cell. Examples (Hebrew):

| Raw key            | Hebrew label                |
| :----------------- | :-------------------------- |
| `pro_bibi`         | תומכי נתניהו                |
| `anti_bibi`        | מתנגדי נתניהו               |
| `pro_bennett`      | תומכי בנט                   |
| `anti_bennett`     | מתנגדי בנט                  |
| `pro_ben_gvir`     | תומכי בן גביר               |

Below the table, **a one-line reconciliation note** with the §5 SoV row for the same actor - name the gap between entity-match and stance counts in absolute numbers, not in prose.

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
| תומכי בנט            |    70 |       14,958     |   56 / 12              |
| מתנגדי בנט           |   103 |        5,685     |    0 / 103             |
| תומכי נתניהו         |   109 |       35,356     |   88 / 17              |
| מתנגדי נתניהו        |   264 |       11,131     |    1 / 263             |

**Reconciliation note.** §5 SoV shows 319 entity-match mentions for `<Subject>`; stance-tagged posts here add 173 (70 pro + 103 anti). §5's number is the UNION of both signals; this table shows the stance breakdown alone.
"""


SEC_14_INTRO_MD = f"""<a id="sec-14"></a>
## 14. Operational recommendations

{VOICE}

Open with ONE paragraph (3–5 sentences) that frames the recommendation set: which strategic asymmetry the period exposes, why the moves below are the right answer to it, and what the unifying theme is. Reference §4's headline recommendations by number (14.1, 14.2, …) - the full plans live in the sub-section widgets below.

This widget is the bridge between the analysis and the operational plans. Keep it tight; the substance lives in 14.1–14.5.

---

**Reference example (shape only, ~70 words).**

The week's asymmetry is reach without conviction: `<Subject>` led the field on volume but did not convert the launch into a durable narrative gain. The recommendations below address the three places this leaked - the under-amplified libel-suit response (14.1), the missed `<Rival2>` opening (14.2), and the absent TikTok rebuttal cadence (14.3). Treat them as a single 72-hour cadence, not three independent moves.
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
        _text("v5hdr0000a", HEADER_MD, h=3),
        _text("v5sec02met", SEC_2_MD, h=14),
        _text("v5sec03toc", SEC_3_MD, h=14),
        {**charts["9663d3d12f"], "w": 3},
        {**charts["98546895ea"], "w": 3},
        {**charts["202cd25b9f"], "w": 3},
        {**charts["bcd59c22e8"], "w": 3},
        _text("v5sec04exe", SEC_4_MD, h=24),
        _text("v5sec05sov", SEC_5_MD, h=28),
        {**charts["13246f5607"], "w": 10, "x_inset": True},
        _text("v5sec06pos", SEC_6_MD, h=32),
        _text("v5sec07chr", SEC_7_MD, h=28),
        {**charts["ae7bfdcab8"], "w": 10, "x_inset": True},
        _text("v5sec08a00", SEC_8A_MD, h=26),
        _text("v5sec08b00", SEC_8B_MD, h=14),
        _text("v5sec08c00", SEC_8C_MD, h=20),
        _text("v5sec08d00", SEC_8D_MD, h=12),
        _text("v5sec09nar", SEC_9_MD, h=22),
        {**charts["fa75ec9fdb"], "w": 10, "x_inset": True},
        _text("v5sec10plt", SEC_10_MD, h=14),
        {**charts["102d4ef2b1"], "w": 5, "x_inset": True},
        {**charts["6f616f581a"], "w": 5, "x_side": 6},
        _text("v5sec11chn", SEC_11_MD, h=20),
        {**charts["bad3e8fbe0"], "w": 10, "x_inset": True},
        _text("v5sec12aud", SEC_12_MD, h=18),
        _text("v5sec13rsk", SEC_13_MD, h=16),
        _text("v5sec14int", SEC_14_INTRO_MD, h=6),
        _text("v5sec14r01", SEC_14_X_MD_TEMPLATE.format(n=1), h=18),
        _text("v5sec14r02", SEC_14_X_MD_TEMPLATE.format(n=2), h=18),
        _text("v5sec14r03", SEC_14_X_MD_TEMPLATE.format(n=3), h=18),
        _text("v5sec14r04", SEC_14_X_MD_TEMPLATE.format(n=4), h=18),
        _text("v5sec14r05", SEC_14_X_MD_TEMPLATE.format(n=5), h=18),
        _text("v5secapp00", APPENDIX_MD, h=34),
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
    title = "Weekly Competitive Brand Report (Template v5)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"v5 layout: {len(layout)} widgets ({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN - not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(V5_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V5_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "orientation": "vertical",
        "title": title,
        "is_template": True,
    })

    now_iso = "2026-05-14T08:00:00+00:00"
    db.collection("explorer_layouts").document(V5_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v5 template: dashboard_layouts/{V5_TEMPLATE_ID}")
    print(f"Wrote v5 explorer entry: explorer_layouts/{V5_TEMPLATE_ID}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
