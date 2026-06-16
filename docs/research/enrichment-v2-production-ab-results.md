# v2 production A/B — results (live cutover)

**Action taken:** wired the v2 config (`scripts/oneoff_v2_enrichment.py`) into the agent as
**version 8**, re-enriched the FB collection `2151c726…` live. Read-path dedup
(`agent_version DESC`) makes **v8 the default** the dashboard/Brief now shows; v7 rows
retained for comparison. Model: `gemini-3.1-flash-lite-preview`. Revert path: ship a v9
with the old config (no deletes needed).

## Coverage — v7 vs v8 (same agent, same source)

| Metric | v7 | v8 | 
|---|---|---|
| Posts enriched | 384 | **400** (v7 had silently dropped 16) |
| Posts with brand stance | ~82 opposed / 44 supports, drift-prone | **178 (44%)**, enum-clean |
| In-market buyers identified | **0** (no field) | **141 (35%)** |
| `main_topic` populated | 220/384 (57%) | **388/400 (97%)** |
| Brand label drift | `flycard`/`fly card`/`Cal`/`cal`… | **0** (enum) |
| Relevance | binary 211/173 | core 127 · brand_signal 107 · off_topic 159 |

## The favorability map (what Cal & Isracard are buying)

**Brand × stance (v8):**

| brand | positive | considering | negative | neutral | read |
|---|---|---|---|---|---|
| **Isracard** | 9 | 36 | **45** | 19 | lightning rod — **5:1 negative**, big undecided pool |
| **Cal** | 25 | 26 | 25 | 35 | balanced; **2.7× more positive mentions** than Isracard |
| Max | 5 | 3 | 2 | 3 | small, mildly positive |
| El Al | 0 | 0 | 12 | 2 | airline taking flak for the whole shift |
| Diners | 0 | 2 | 5 | 7 | acceptance gripes |
| Amex | 3 | 3 | 5 | 14 | mostly neutral |

**Headline for the Brief:** *Isracard owns the negativity (fees + service + migration pain),
Cal is the relative favorite and the brand people are loyal to, and a large persuadable
middle is still deciding.*

**In-market battleground (141 deciding now):** undecided **72 (51%)** · leaning Isracard 16 ·
leaning Cal 10 · Max 2 · n/a 41. Note the tension worth a slide: Isracard is the most
*disliked* yet slightly more in-market leaners tilt to it — it's becoming the default
post-transition issuer, so dislike ≠ rejection. That gap is the conversion opportunity for
both clients.

**Decision drivers (top aspects):** pricing_value 44 · fees 37 · migration_process 35 ·
customer_service 31 · accrual_rate 20 · card_acceptance 18 · app_digital 13. Fees + value +
migration confusion dominate; **customer service is the #1 place Cal beats Isracard** (the
recurring "Cal's service is better" thread).

## Honest caveats / v9 backlog
- **`aspect="other"` = 50** and **`brand="other"` negative = 7**: the enum is missing a few
  real buckets — **fx_rate** (dollar rate charged on El Al bookings — seen in smoke test),
  **physical_card_delivery** (recurring "card never arrived"), **eligibility** (family/business
  cards), and **Issta** as a named entity. Add in v9.
- **12/400 `main_topic` null** — model occasionally omits despite `Other` existing; make
  required in the prompt or post-fill `Other`.
- Same source-bias + no-comments + no-engagement limits as before — v8 enriches richer but
  doesn't fix the data thinness (upstream collection work).
- Stance precision not yet human-audited at volume; flash-lite may over/under-call
  `considering`. Recommend a 30-post human precision check before client delivery.

## Net
v8 is live and is a step-change for the report: a clean per-brand favorability map, a sized
in-market battleground, and ranked decision drivers — none of which v7 could produce. The
remaining work is (1) a small v9 enum top-up, (2) a precision spot-audit, (3) the upstream
collection fixes (comments + engagement + broader sources).
