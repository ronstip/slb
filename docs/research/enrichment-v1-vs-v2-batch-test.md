# v1 vs v2 enrichment — 42-post head-to-head

**Method:** stratified sample of 42 posts from agent `22bee852…` (26 that v1 marked
related + 16 v1 marked not-related), full Hebrew content. I re-enriched each under the
**v2 config** (`enrichment-v2-prompt-and-schema.md`) and compared field-by-field to the
stored v1 output. v2 here = my manual application of the v2 schema (model proxy), not a
production run — directional, not a benchmark.

## Headline numbers

| Dimension | v1 | v2 | Lift |
|---|---|---|---|
| Relevant posts with **any brand stance** | 9/26 (35%) — *2 flawed* | 22/26 (85%) | **+50pts** |
| …clean (non-contradictory) stance | 7/26 (27%) | 22/26 (85%) | **+58pts** |
| **In-market / undecided buyer** flagged | 0 (no field) | 14/29 (48%) | **net-new** |
| Relevant posts with a `main_topic` | 25/26 (1 null) | 26/26 | +1 |
| `main_topic` mis-bucketed (junk drawer) | 3/26 (#1,#11 Exclusivity; +) | 0 | fixed |
| Relevance errors (FP+FN) found | ≥5 | corrected | see below |
| Hard data bugs surfaced | 4 | n/a | — |

The story: v1 captured stance **only when explicit** (~1/3 of relevant posts) and had
**no concept of the undecided buyer** — the single biggest commercial signal. v2 captures
implicit lean + the in-market battleground, and fixes relevance at both edges.

---

## Concrete v1 bugs this test surfaced

1. **`#26` — same brand in supports AND opposed.** v1: `supports=["isracard"], opposed=["isracard"]`. Contradictory; pollutes any favorability tally. (Post is a skeptical essay on points-value, mentioning Issta negatively — v2: `Brand_War_&_Trust`, other/issta negative.)
2. **`#11` — hallucinated relevance + stance on an airline post.** "If I booked a *Fly Plus* benefit and the flight is cancelled, is it credited?" is an **El Al fare benefit**, not an issuer. v1: related=true, `supports=["el_al"]`, topic `Exclusivity`. v2: `off_topic` (no card/issuer). Clean false-positive.
3. **`#14` — relevant complaint with `main_topic=null`.** "Ordered Isracard FlyCard a month ago, still not delivered, glitch…" v1 got sentiment/opposed right but **left the topic null** (no Customer_Service bucket existed). v2: `Customer_Service_&_Sales_Tactics`, isracard −service intensity 3.
4. **`#30` — card-relevant post marked not-related, yet still scored.** "What's the difference, why pick American [Express] if many businesses don't accept it?" v1: related=**false** but still emitted `opposed=["American Express"]` (incoherent). This is textbook `Card_Network_&_Acceptance` — v2 keeps it (`core`, amex −card_acceptance).

---

## Relevance reclassifications (v2 vs v1)

| # | post (gist) | v1 | v2 | who's right |
|---|---|---|---|---|
| 11 | El Al "Fly Plus" fare credit if flight cancelled | related | **off_topic** | v2 (airline, not issuer) |
| 30 | why Amex if shops don't accept it | not-related | **core** (acceptance) | v2 |
| 35 | "Amex Premium holders — need to do anything?" | not-related | **brand_signal** (transition) | v2 |
| 29 | transfer El Al points to spouse's FlyCard | not-related | **brand_signal** (redemption) | v2 (borderline) |
| 39 | link to all bonus-ticket destinations | not-related | **brand_signal** (redemption) | v2 (borderline) |

v2's 3-class is the enabler: #35/#29/#39 aren't head-to-head comparisons (so not `core`)
but are real card/points signal — `brand_signal` keeps them instead of discarding. The
16 genuinely off-topic airline posts (#27,28,31–34,36–38,40–42) **both** versions drop —
v2 doesn't get noisier, it gets sharper.

---

## Where v2 adds signal v1 had none — worked examples

**`#1`** "I spend ~30–35k/mo — is FlyCard worth getting?"
- v1: `neutral`, topic `Exclusivity_vs_Flexibility` (junk), no stance → **looks like inert noise.**
- v2: `in_market=true`, `considering cal/pricing_value`, `leaning=undecided`, blocker `accrual_value`, topic `Points_Earning_Value` → **a live prospect, undecided, blocked on whether the math works.**

**`#4`** "Have Diners FlyCard, Isracard messaged me about switching — thoughts?"
- v1: `neutral`, topic `Migration`, no stance.
- v2: `switching_decision`, `considering isracard` (`switch_from=cal/diners→switch_to=isracard`), `in_market=true`, blocker `migration_process` → **a switch in play, direction tagged.**

**`#9`** (the 40₪ retention post) — *both* got the direction (v1: +cal/−isracard). v2 adds the *why*: `−isracard/fees i3`, `+cal/value i2`, `leaning=cal`, topic `Membership_Fees`. So v1 ≈ v2 on explicit posts; v2 pulls ahead on the implicit/undecided majority.

**`#20`** "Don't rush to Isracard — they overpaid for the franchise, already reported losses, they're under pressure."
- v1: −isracard/+cal, topic `Migration`.
- v2: same direction + `aspect=trust_transparency`, topic `Brand_War_&_Trust` → routes to the right report section (PR/trust war, not migration mechanics).

---

## Honest caveats
- This is one annotator (me) applying v2, not a model run — expect the production model to
  under-fill `considering`/implicit lean somewhat vs my hand labels. The few-shot examples
  in the config are there to close that gap; **a real model A/B is the next validation.**
- v2 raises stance *volume*; some `considering`/intensity-1 calls are genuinely debatable.
  That's acceptable for a report (intensity lets you threshold) but means precision should
  be spot-audited after the first production batch.
- Engagement-weighting and comments are still absent — v2 makes each post richer but does
  **not** fix the source bias or the missing reply-layer (separate, upstream work).

## Verdict
On this batch v2 is strictly better: it fixes 4 data bugs, corrects ≥2 clear relevance
errors, tightens topics, and — most importantly — turns ~14 "neutral user questions" into
identifiable **in-market buyers with a lean and a blocker**, which is the product Cal and
Isracard are actually buying. Recommend a production A/B (v2 config on the same agent, new
version) measuring: stance coverage %, in_market %, topic-null %, and a 30-post human
precision audit.
