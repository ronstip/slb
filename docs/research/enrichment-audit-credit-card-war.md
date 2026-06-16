# Enrichment Audit — "Israel Credit Card War" (Cal vs Isracard)

**Agent:** `22bee852-039c-40d9-80a6-4c44d074d1c9` — *"Israel Credit Card War: Fly Card & Travel Rewards"*
**Scope analyzed:** enrichment v7 — 384 distinct posts (211 relevant / 173 not-related). v6 (50 posts) ignored.
**Source:** one Facebook group, `אל על הנוסע המתמיד - פליי קארד` (El Al Frequent Flyer – Fly Card), group_id `1526461191971818`.
**Goal of audit:** decide how to rebuild the enrichment + data infra so it produces reports Cal and Isracard will pay for — i.e. *what the public actually thinks about the travel-card shift.*

---

## TL;DR

The **narrative** enrichment is good (ai_summary, context, relevance_reason are accurate and well-reasoned). The **structured / analyzable** enrichment — the part a report is built from — is largely broken:

1. **The most valuable signal — per-brand stance (who the public favors) — is captured but under-covered and drift-prone.** `supports` 44/384 (cal 17 > isracard 6), `opposed` 82/384 (isracard 31 > cal 13), `comparison_logic` 140/384. Directionally real (group leans pro-Cal) but only ~11–21% filled, with casing/typing drift. *(Corrected — see Addendum v2; an earlier draft wrongly said 0/384 due to a JSON_VALUE-on-array query bug.)* The bigger miss: **undecided in-market buyers (Migration_Confusion, 71 posts) have no field at all.**
2. **Brand & theme values are un-normalized free text** → the same product appears as `fly card` / `flycard` / `fly all` / `flyall` / `fly card premium`; `loyalty program` exists as 5 variants. Nothing aggregates cleanly.
3. **Post-level sentiment is the wrong unit.** A post can be anti-Isracard *and* pro-Cal; one `sentiment=negative` destroys that.
4. **The data itself is too thin and too biased to answer the question** — El Al-loyalist group only, **0 comments collected**, **0 engagement metrics**, ~12 days of data (not the requested 30).

Below: evidence, then a concrete redesign with target schema + a worked example.

---

## 1. Source & collection problems (these cap everything downstream)

These are upstream of enrichment but they decide whether *any* enrichment can answer Cal/Isracard's question.

| Problem | Evidence | Why it matters for the report |
|---|---|---|
| **Single, self-selected source** | All 433 rows from one group: *El Al Frequent Flyer – Fly Card*. | Audience is pre-filtered El Al fans → El Al is the #1 detected brand (159) and #1 "primary brand" (132). This is **not "the public"** — it's the most pro-El-Al/pro-FlyCard segment that exists. A report claiming public sentiment from this group is sampling-biased. |
| **0 comments collected** | `post_type` = `text` for **433/433**; no `comment` rows. | In a FB group the *question* is one post; the **30 replies** ("go FlyCard, Isracard service is awful") are where opinion, recommendations and stance live. We threw away the richest opinion layer and enriched only the prompts. |
| **0 engagement metrics** | `platform_metadata` has no likes/reactions/num_comments; `has_engagement = 0`. | Every post weighted equally — a post seen by 5 people counts the same as one seen by 5,000. Cal/Isracard need *which* gripes and comparisons resonated, not a flat list. |
| **Window shorter than requested** | data_scope `time_range_days=30`, `data_start_date=2026-05-13`, but actual `posted_at` spans only **2026-06-02 → 2026-06-14** (~12 days). | Trend lines ("did sentiment move after launch X?") are impossible on 12 days. Verify the collector isn't silently truncating. |
| **Posts table fan-out** | 384 distinct posts but JOIN `posts`↔`enriched_posts` returns **433 rows** (~13% inflation; same post collected under multiple collections). | Naive report SQL double-counts ~13% of posts. Reports must dedup on `post_id`. |

---

## 2. Schema-level problems

The enrichment schema (`bigquery/schemas/enriched_posts.sql`) was designed generic, not for a brand-competition question.

- **`detected_brands` and `entities` are redundant and both flat.** They overlap heavily (isracard 97/97, cal 75/75) and mash four different entity *types* into one bag:
  - card **issuer**: Cal, Isracard, Max, Diners
  - card **product**: FlyCard, FlyAll, SkyMax, Fly Card Premium
  - airline **partner**: El Al, Arkia, Israir
  - card **network**: Amex, Visa, Mastercard
  - **bank**: Leumi, Hapoalim, Discount

  A credit-card-war report needs these as *typed* dimensions (issuer vs product vs airline). Today you can't ask "sentiment toward issuer Cal" without manually untangling.

- **`custom_fields` schema is right in spirit, dead in practice.** Fields `supports`, `opposed`, `comparison_logic`, `main_topic`, `primary_brand_mentioned` are exactly the competitive signal — but:

  | field | populated | notes |
  |---|---|---|
  | `supports` | **44 / 384 (11%)** | cal 17, el_al 13, isracard 6 — real but under-covered + casing drift (`cal`/`Cal`) |
  | `opposed` | **82 / 384 (21%)** | isracard 31, el_al 25, cal 13 |
  | `comparison_logic` | **140 / 384 (36%)** | present more often than stance |
  | `main_topic` | 220 / 384 (57%) | good vocab (`Migration_&_Transition_Confusion`, `Cashback_Rates_&_Value_Props`); 43% null |
  | `primary_brand_mentioned` | 290 / 384 (75%) | but **El Al (airline) is the top value (132)**, and `other`+`null` = 148 (38%) unusable. Single-brand cap loses comparisons. |

  The fields work when stance is explicit; the gaps are coverage (implicit/comparative lean), canonicalization (casing/lang drift), and entity typing (airline mixed with issuer). See Addendum v2 for the experiment behind this. (Empties on hard cases match the known pattern: one-sided instructions + no calibration → conservative output.)

---

## 3. Field-by-field quality review

### Works well — keep
- **`ai_summary`** — accurate, specific, captures the actual situation. e.g. the Isracard-retention-call post is summarized correctly incl. the 40₪ fee and the rejection.
- **`context`** — good one-liner framing per post.
- **`relevance_reason` + `is_related_to_task`** — well-reasoned and, on inspection, correct: El Al flight-refund complaint → not related; generic Gold-status downgrade → not related; FlyAll/FlyCard comparison → related. Filtering logic is sound.

### Broken / low-value

**`sentiment`** — 75% neutral (289), 22% negative (85), 3% positive (10).
- Wrong unit (post-level, not brand-level). Real example:
  > `ישראכרט לא מוכנים להשוות את תנאי הפלייכארד שיש לי היום בכאל ודורשים 40 שקלים בחודש... הצחיקו אותי`
  > ("Isracard won't match my current Cal FlyCard terms and want 40₪/mo... they made me laugh")
  Tagged `sentiment=negative`. Truth: **negative→Isracard, loyal→Cal.** The one field collapses two opposite stances. This is the post Cal/Isracard most want and it's mis-encoded.
- Neutral inflation: comparison *questions* are scored neutral, so the dominant tone of the dataset reads "neutral" when it's really "actively shopping / undecided" — a different and more valuable state.

**`emotion`** — 66% neutral, 29% frustration, rest negligible. Low information; redundant with sentiment. Not actionable for the brief.

**`content_type`** — 74% "user question" (285/384).
- Over-collapsed. "Which card is better, FlyAll or FlyCard?" is a **purchase-consideration / comparison-shopping** signal — the gold of a competitive report — but it's filed under the same generic "user question" as "what's my baggage allowance?". The high-intent buying moment is invisible.

**`channel_type`** — 382 ugc / 1 media / 1 influencer. Single-source → no variance → useless dimension here.

**`themes`** — free text, no controlled vocabulary → synonym sprawl:
- `loyalty program` (49) · `loyalty programs` (18) · `travel loyalty programs` (10) · `credit card loyalty programs` (9) · `travel loyalty program` (6) — one concept, 5 buckets.
- `customer service` (37) · `customer support` (21) · `customer support question` (7) · `customer service complaint` (8) — same.
- `credit card transition` (10) · `credit card migration` (9) — same.
Any "top themes" chart is wrong until these are merged.

**`detected_brands` / `entities`** — same fragmentation on the *core* dimension:
- FlyCard product: `fly card` (24) + `flycard` (14) + `fly card premium` (2) + `fly card cal premium` (1) ≈ **41** but charts show 24.
- FlyAll: `flyall` (25) + `fly all` (2).
- SkyMax: `sky max` (5) + `skymax` (2).
- Hebrew/English split: `el al` (159) + `אל על` (1); `discount bank` vs `bank discount`; `visa cal` vs `cal`.
No canonicalization → every brand ranking under-counts the leaders and is unstable.

---

## 4. What "good" looks like — proposed redesign

Design the enrichment **for the question**: *how does the relevant public feel about each card/issuer in this shift, on which aspects, and which way are they leaning.*

### 4.1 Fix the data first
1. **Collect comments**, not just posts (`facebook-comments-scraper` is already wired per project notes). Enrich comments as first-class opinion units, linked to parent via `parent_post_id`.
2. **Capture engagement** (reactions, comment count, and per-comment likes) so opinions can be **reach-weighted**.
3. **Broaden sources** beyond one loyalist group — add neutral consumer groups, the issuers' own pages' comment sections, X/Reddit/news comments — and **tag each source's bias** so the report can segment ("loyalists vs general public").
4. Confirm the **full requested window** is actually collected.

### 4.2 Typed entity model (replace flat `detected_brands`/`entities`)
```jsonc
"brands": [
  {"name":"FlyCard","type":"card_product","issuer":"Cal","canonical_id":"cal_flycard"},
  {"name":"Isracard","type":"issuer","canonical_id":"isracard"},
  {"name":"El Al","type":"airline_partner","canonical_id":"elal"}
]
```
- Maintain a **canonical alias map** (`flycard|fly card|פליי קארד|fly card premium → cal_flycard`) applied at enrichment time, so aggregation is exact. Type field lets the report separate *issuer* sentiment from *product* sentiment from *airline* noise.

### 4.3 Per-brand, aspect-based stance (the core new object)
Replace single `sentiment` + the dead `supports/opposed` with one explicit array — **one entry per brand the post takes a position on**:
```jsonc
"brand_stance": [
  {
    "canonical_id":"isracard",
    "stance":"negative",          // positive | negative | neutral | considering
    "aspect":"fees",              // controlled vocab, see 4.4
    "intensity":3,                // 1–3
    "evidence":"won't match Cal terms, wants 40₪/mo fee"
  },
  {
    "canonical_id":"cal_flycard",
    "stance":"loyal",             // staying with current provider
    "aspect":"value",
    "intensity":2,
    "evidence":"happy with current FlyCard terms, refused to switch"
  }
]
```
This single change is what makes "Cal vs Isracard favorability" computable. With it, the 40₪ post correctly contributes **−Isracard / +Cal**, not one mushy "negative".

### 4.4 Controlled vocabularies (enforced, not free text)
- **`aspect`** (the dimension of debate): `accrual_rate`, `fees`, `flight_availability`, `customer_service`, `migration_process`, `card_acceptance`, `signup_bonus`, `perks_lounge`, `points_expiry`. Map themes onto this fixed set.
- **`post_intent`** (replace over-broad `content_type`): `comparison_request`, `recommendation_given`, `complaint`, `praise`, `migration_question`, `news_share`, `off_topic`. Surfaces the high-intent comparison/recommendation moments explicitly.
- **`main_topic`** already has a good vocab — keep it, but **make it required** (currently 43% null).

### 4.5 Schema / prompt discipline
- Enforce structured output (`response_schema`) so stance/aspect can't be silently dropped; require at least a stance entry per relevant brand or an explicit `"no_stance": true`.
- Add **few-shot examples in the prompt** (incl. one mixed-stance Hebrew post like the 40₪ example) — the model left `supports/opposed` null because it had fields but no demonstrations and no coverage target.
- Pair "be strict about relevance" with a coverage target (don't over-drop) — same calibration lesson already in project memory.

### 4.6 Keep
ai_summary, context, relevance_reason/is_related_to_task, language. They're good.

### Worked example — same real post, current vs proposed

Post: *"Isracard won't match my Cal FlyCard terms and want 40₪/mo... they made me laugh, keep calling/emailing, not switching. Period."*

| | Current enrichment | Proposed enrichment |
|---|---|---|
| sentiment | `negative` (toward what?) | brand_stance: Isracard −3 (fees, migration), Cal +2 (loyal/value) |
| intent | `complaint` | `migration_question`→ actually `retention_rejection` |
| brands | `["isracard","cal"]` flat | typed: issuer Isracard, product cal_flycard |
| aspect | (none) | `fees`, `migration_process` |
| usable in report? | no — adds noise to "negative" pile | yes — direct +Cal/−Isracard retention data point |

---

## 5. Priorities (do in this order)

1. **Collect comments + engagement, broaden & bias-tag sources.** Without this, no enrichment redesign can answer "what the public thinks." (Highest leverage, upstream.)
2. **Add `brand_stance[]` (per-brand, aspect, stance, intensity, evidence).** The one field that makes the brief possible.
3. **Canonical alias map + typed entities.** Makes every ranking correct.
4. **Controlled vocabs for aspect / intent; make main_topic required; enforce via response_schema + few-shot.**
5. **Reach-weighting + post_id dedup in the report layer.**

Items 2–4 are enrichment-prompt + schema work (days). Item 1 is collection work but is the precondition for the data being worth selling.

---

# Addendum v2 — corrections + experiment-backed plan (after review)

## Correction to §2 (I was wrong)
My "0/384" for supports/opposed was a **query bug** — `JSON_VALUE` returns null on JSON *arrays*; I should have used `JSON_QUERY`. Re-measured:

| field | populated | top values |
|---|---|---|
| `supports` | **44/384 (11%)** | cal 17, el_al 13, isracard 6 |
| `opposed` | **82/384 (21%)** | isracard 31, el_al 25, cal 13 |
| `comparison_logic` | **140/384 (36%)** | — |
| `main_topic` | 220/384 (57%) | Migration_Confusion 71, Cashback_Value 47, Exclusivity_vs_Flexibility 46, Booking_Portals 26, Sign-up 16, Branding_War_&_Deception 8, FX_Fees 6 |

So the stance signal **exists and is directionally real** (group leans pro-Cal, Isracard most-opposed). The problems are **coverage, canonicalization, and typing — not absence.** `main_topic`'s vocabulary is genuinely report-grade. Keep the design; fix execution.

## Q2 — verdict on the relevance filter
Precise and well-reasoned on clear cases (flight-ops/status/baggage questions correctly dropped). **Two real flaws:**
1. **Too-narrow task definition → false negatives that are exactly the signal.** It dropped *"bank can't issue Isracard, their call center won't call back... we'll stay with Cal"* as "purely customer service." That is **Isracard→Cal defection over service** — top-value churn data. Service/billing/app-driven switching must count as relevant.
2. **Binary is lossy.** Replace with a 3-class relevance: `core` (cards/competition) · `brand_signal` (any Cal/Isracard/Max experience incl. service/churn/fees) · `off_topic` (pure airline ops). Keep `brand_signal` in a separate bucket instead of discarding. 45% drop rate on a single noisy source is too aggressive for a paid brief.

## Q3 — fixed objects for Cal/Isracard/Max? (experiment-driven answer)
Tested all three designs against the 12-post batch:

- **Free-text arrays (current):** drift (`cal` vs `Cal`, `el_al` vs `EL AL`, `Fly Card`/`FlyCard`), and they **under-cover implicit lean** (post 12 missed).
- **Fully-fixed per-brand objects `{cal, isracard, max}`:** forcing the model to answer "stance toward X?" per brand **fixes the coverage gap** (post 12 would capture "Isracard: crazy fees → leaning against"). But: Max is sparse (10 mentions, 4 stance) → ~97% null objects = token waste + hallucination risk; and it ignores Amex (28) and El Al (the airline everyone references).
- **Recommended hybrid (best of both):** a **fixed enum** for the focal set `{cal, isracard, max, amex, el_al, diners, other}` (kills drift) + a **stance array with one entry per engaged brand** (no null waste). Prompt the model to **always assess Cal and Isracard explicitly** (the two focal brands → coverage), but only emit Max/others when present.

So: **fixed *vocabulary*, yes; fixed *per-brand object slots*, no.** Force-assess only the 2 brands the customer is paying about.

### Proposed stance object (per engaged brand)
```jsonc
"brand_stance": [{
  "brand": "isracard",              // ENUM — no free text
  "role": "issuer",                 // issuer | card_product | airline_partner | network | bank
  "stance": "negative",             // positive | negative | considering | neutral
  "aspects": ["fees","accrual_rate"], // controlled vocab
  "intensity": 2,                   // 1–3
  "is_customer": true,              // poster is/was a customer (churn signal)
  "switch_from": "isracard", "switch_to": "cal",  // nullable — direct churn capture
  "evidence": "crazy fees, nothing special"
}]
```

### The missing top-level object — the migration battleground (71 posts have no home today)
```jsonc
"consideration": {
  "in_market": true,                       // actively deciding
  "deciding_between": ["cal","isracard"],
  "leaning_toward": "undecided",           // cal | isracard | max | undecided
  "blockers": ["fees","migration_process"],// what's stopping the decision
  "trigger": "1.1.27 program change"
}
```
This converts "Migration_Confusion" from a flat label into **who is in play, leaning which way, blocked by what** — the core deliverable for both clients.

## Coverage rule (the actual root cause)
Current low fill is partly *correct* (a pure "how do I book?" question has no stance — emptiness is right there). The failure is **implicit/comparative lean** (post 12, 8, 10). Fix with prompt discipline, not just schema:
- Few-shot the prompt with a mixed-stance example AND an implicit-lean example.
- Require: for Cal and Isracard, if the post expresses *or implies* a lean, emit an entry; else explicit `"no_stance": true`. Pair the "be strict" instruction with this coverage target (avoids the known over-drop failure mode).

## Net plan (revised priority)
1. **Collection:** add comments + engagement; broaden + bias-tag sources. (Unchanged — still the precondition; this single group is pro-El-Al-biased and comment-less.)
2. **Relevance → 3-class**, keep `brand_signal` (service/churn) instead of dropping it.
3. **Hybrid stance:** enum vocabulary + per-engaged-brand array, force-assess Cal & Isracard, typed roles.
4. **Add `consideration` object** for the in-market/migration battleground.
5. **Few-shot + coverage target** for implicit lean; canonical alias map applied at write time.
6. Report layer: post_id dedup + reach-weighting.
