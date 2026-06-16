# Enrichment v2 — editable config for the Credit-Card-War agent

This is the **editable surface only** (what the agent/task stores). The base fields
(`context`, `ai_summary`, `language`, `sentiment`, `emotion`, `entities`, `themes`,
`relevance_reason`, `is_related_to_task`, `detected_brands`, `channel_type`) are fixed
in `workers/enrichment/enricher.py` and unchanged. We steer everything competitive
through three editable inputs:

1. `enrichment_context` — the task string (the relevance yardstick + scope).
2. `content_types` — closed vocab → overrides base `content_type: str` with a Literal.
3. `custom_fields` — `list[CustomFieldDef]`; **descriptions become prompt text, types become the response schema.**

Design rationale (from the audit + batch experiment): fixed *vocabulary* not fixed
*object slots*; force-assess only Cal & Isracard; capture implicit lean; give the
migration battleground its own fields; widen relevance to include service/fee/app/churn.

> **Type constraints honored:** custom-field types are `str|bool|int|float|list[str]|literal|list[object]`.
> A `list[object]` is one level deep and its element fields are scalar-only (`str|bool|int|float|literal`) —
> **no nested lists**. That's why each `brand_stance` entry carries a *single* `aspect` (emit one entry per
> brand×aspect) and why `consideration` is flattened to top-level fields (no bare-object type exists).

---

## 1. `enrichment_context` (task string — paste verbatim)

```
Subject: the Israeli travel-rewards credit-card competition — the credit-card ISSUERS
Cal (FlyCard / FlyAll), Isracard (FlyCard), and Max (SkyMax), and their El Al-linked
travel-points cards, during the 2026 program transition.

A post is IN SCOPE if it shows ANY first-hand opinion, experience, comparison, question,
or switching decision about one of these issuers or their travel cards — INCLUDING
customer service, call-center, billing, card fees, the app/digital experience, points
accrual/redemption, card acceptance, or migrating between issuers. A service complaint
or a "I'm switching from X to Y" post IS in scope even if it never uses the words
"loyalty program" — issuer-level experience and churn are the core signal.

A post is OUT OF SCOPE only when it is purely about airline operations with no issuer/
card angle: El Al flight schedules, seat availability, baggage, frequent-flyer *status*
mechanics, ticket changes, or generic travel logistics. El Al as an AIRLINE is context,
not the subject; do not treat a flight complaint as issuer signal unless a card/issuer
is actually involved.

This task is a yardstick, not a hint — judge only from what the post shows.

CANONICAL NAMING — this fixes label drift WITHOUT seeding. When (and only when) you
actually observe a brand/product/network in the post, write it in EVERY output field
using the canonical form below. Never add one you don't observe; normalization is not
detection.
  Issuers:   Cal | Isracard | Max
  Products:  FlyCard (Cal & Isracard tiers) | FlyAll (Cal) | SkyMax (Max)
             — map flycard / "fly card" / "פליי קארד" / "פלייקארד" → FlyCard;
               flyall / "fly all" / "פליי אול" / "פלי אול" → FlyAll;
               skymax / "sky max" → SkyMax
  Networks:  American Express | Visa | Mastercard | Diners
  Airline:   El Al  (the airline / Matmid club — this is CONTEXT, not an issuer)
For free-text label fields (themes), use short lowercase singular noun phrases and reuse
the aspect vocabulary terms where they fit (e.g. "fees", "customer service", "points
accrual") instead of inventing near-duplicates like "loyalty program" vs "loyalty programs".
The enum fields (brand_stance.brand, aspect, main_topic) are the clean source of truth for
reporting; entities/themes/detected_brands are exploratory only.
```

## 2. `content_types` (closed vocab → Literal)

```json
["comparison_request","recommendation","complaint","praise","switching_decision",
 "migration_question","how_to_question","news_or_promo","astroturf_warning","other"]
```

Rationale: splits the old 74%-"user question" blob into the moments that matter —
`comparison_request` and `switching_decision` are the high-intent buying signals;
`astroturf_warning` captures the "don't trust paid commenters" posts already showing up.

---

## 3. `custom_fields` (paste into agent config)

Descriptions are written AS the model-facing prompt (coverage rules embedded).

```json
[
  {
    "name": "relevance_class",
    "type": "literal",
    "options": ["core", "brand_signal", "off_topic"],
    "description": "Three-way relevance. 'core' = about the issuer competition, card comparison, accrual/value, or the 2026 transition. 'brand_signal' = a first-hand experience/opinion about Cal/Isracard/Max OR their card (service, fees, billing, app, acceptance, churn) that is NOT a head-to-head comparison but is still real brand signal. 'off_topic' = pure airline ops / flight logistics / FF-status with no issuer or card angle. Set the base is_related_to_task = true for BOTH 'core' and 'brand_signal'; false only for 'off_topic'."
  },
  {
    "name": "brand_stance",
    "type": "list[object]",
    "description": "One entry per (brand x aspect) the post expresses OR implies a position on. ALWAYS assess Cal and Isracard explicitly: if the post leans for/against either — even implicitly (e.g. 'Isracard's fees are crazy, nothing special') — emit an entry; if it truly takes no position on a brand, emit nothing for it (do not invent stance). Capture comparative posts as multiple entries (e.g. +cal/service AND -isracard/service). Leave the list empty for pure how-to questions with no brand opinion.",
    "element_fields": [
      { "name": "brand", "type": "literal",
        "options": ["cal","isracard","max","american_express","diners","el_al","other"],
        "description": "Canonical brand. Map ALL variants to these: FlyCard/FlyAll/'fly card'/'פליי קארד'/Cal=cal; Isracard FlyCard=isracard; SkyMax/'sky max'=max; Amex='american express'=american_express; El Al/'אל על' (airline/club)=el_al." },
      { "name": "role", "type": "literal",
        "options": ["issuer","card_product","airline_partner","network","bank","other"],
        "description": "What this brand IS in the post: credit-card issuer (Cal/Isracard/Max), card_product (a specific FlyCard/FlyAll/SkyMax tier), airline_partner (El Al), network (Visa/MC/Amex/Diners), or bank." },
      { "name": "stance", "type": "literal",
        "options": ["positive","negative","considering","neutral"],
        "description": "Poster's position toward this brand on this aspect. 'considering' = weighing/undecided about adopting or switching to it (not yet positive/negative)." },
      { "name": "aspect", "type": "literal",
        "options": ["accrual_rate","fees","flight_availability","customer_service","migration_process","card_acceptance","signup_bonus","perks","points_expiry","app_digital","pricing_value","trust_transparency","other"],
        "description": "The single dimension this stance is about. If the post hits two dimensions for one brand, emit two entries." },
      { "name": "intensity", "type": "int",
        "description": "Strength of the stance, 1 (mild/implicit) to 3 (strong/explicit)." },
      { "name": "is_customer", "type": "bool",
        "description": "True if the poster is or was a customer of this brand (first-hand), false if discussing it from outside." },
      { "name": "switch_from", "type": "literal",
        "options": ["cal","isracard","max","american_express","diners","none"],
        "description": "If the post describes leaving/considering leaving a brand, the brand being left; else 'none'." },
      { "name": "switch_to", "type": "literal",
        "options": ["cal","isracard","max","american_express","diners","none"],
        "description": "If the post describes adopting/considering adopting a brand, the destination brand; else 'none'." },
      { "name": "evidence", "type": "str",
        "description": "Short English quote/paraphrase of the exact words that justify this stance." }
    ]
  },
  {
    "name": "in_market",
    "type": "bool",
    "description": "True if the poster is actively deciding whether to get, keep, upgrade, or switch a travel card right now (a live purchase/retention decision). This is the conversion battleground — be generous: migration-confusion and 'which should I pick' posts are in_market=true."
  },
  {
    "name": "consideration_set",
    "type": "list[str]",
    "description": "Canonical brand ids the poster is weighing against each other (subset of cal/isracard/max/american_express/diners). Empty if not comparing/deciding. Use the canonical ids only."
  },
  {
    "name": "leaning_toward",
    "type": "literal",
    "options": ["cal","isracard","max","american_express","undecided","none"],
    "description": "If in_market, which brand the poster currently leans toward. 'undecided' if actively torn; 'none' if not in_market."
  },
  {
    "name": "decision_blocker",
    "type": "literal",
    "options": ["fees","migration_process","accrual_value","flight_availability","card_acceptance","trust_transparency","information_gap","none"],
    "description": "The single biggest thing stopping/complicating the decision (e.g. crazy fees, confusion about the 1.1.27 transition, can't tell which accrues more). 'information_gap' when the blocker is simply not understanding the options. 'none' if not in_market."
  },
  {
    "name": "decision_trigger",
    "type": "str",
    "description": "Short English note on what prompted the decision now (e.g. 'card expiring', '1.1.27 program change', 'Isracard retention call'). Empty if none."
  },
  {
    "name": "main_topic",
    "type": "literal",
    "options": ["Transition_Confusion","Membership_Fees","Points_Earning_Value","Points_Redemption_&_Availability","Customer_Service_&_Sales_Tactics","App_&_Digital_Transparency","Signup_Bonuses_&_Promos","Card_Network_&_Acceptance","Exclusivity_vs_Flexibility","Brand_War_&_Trust","Other"],
    "description": "The single DOMINANT topic of the post (one pick; secondary drivers are captured per-brand in brand_stance.aspect). Definitions: Transition_Confusion = what's changing / which card survives 1.1.27 / FlyAll-vs-FlyCard identity / should I act now. Membership_Fees = monthly/annual card fees, fee waivers, fee negotiation, 'Isracard doubled the fee'. Points_Earning_Value = accrual rate, diamonds/points per spend, 'is it worth it for my spend'. Points_Redemption_&_Availability = using points for flights, award seat availability, destinations, gift cards. Customer_Service_&_Sales_Tactics = call center, reps, aggressive/misleading sales, retention calls, failed card issuance. App_&_Digital_Transparency = seeing accrual in-app, real-time points, digital experience (recurring Cal-vs-Isracard gap). Signup_Bonuses_&_Promos = join bonuses, conditions, bonus shortfalls/disputes. Card_Network_&_Acceptance = Diners/Visa/MC/Amex acceptance and network choice. Exclusivity_vs_Flexibility = the STRATEGIC axis only — El Al-locked points vs fly-any-airline + cashback (FlyAll's pitch); do NOT use as a catch-all. Brand_War_&_Trust = legal/fraud claims (e.g. ICC/Cal FlyAll 'consumer fraud'), competitive PR, astroturfing / paid-commenter suspicion. Other = none of the above."
  }
]
```

---

## 4. Resulting `custom_fields` output schema (per post)

```jsonc
{
  "relevance_class": "core" | "brand_signal" | "off_topic",
  "brand_stance": [
    { "brand": "isracard", "role": "issuer", "stance": "negative",
      "aspect": "fees", "intensity": 2, "is_customer": false,
      "switch_from": "none", "switch_to": "none", "evidence": "crazy fees, nothing special" }
  ],
  "in_market": true,
  "consideration_set": ["cal", "isracard"],
  "leaning_toward": "undecided",
  "decision_blocker": "migration_process",
  "decision_trigger": "1.1.27 program change",
  "main_topic": "Transition_Confusion"
}
```

---

## 5. Worked examples (real posts from this agent)

**Post 12** — *"I hold basic FlyCard at Cal... upgrade free to FlyAll = gain more... but on 1.1.27 worthless? Isracard's = crazy fees, totally regular accrual, nothing special... totally lost, torn what to do."*
*(v1 logged this flat `sentiment=neutral`, no stance — missed everything.)*
```jsonc
{
  "relevance_class": "core",
  "brand_stance": [
    { "brand": "cal", "role": "issuer", "stance": "considering", "aspect": "accrual_rate",
      "intensity": 1, "is_customer": true, "switch_from": "none", "switch_to": "cal",
      "evidence": "upgrade FlyCard free to FlyAll = gain more" },
    { "brand": "isracard", "role": "issuer", "stance": "negative", "aspect": "fees",
      "intensity": 2, "is_customer": false, "switch_from": "none", "switch_to": "none",
      "evidence": "crazy fees, totally regular accrual, nothing special" }
  ],
  "in_market": true,
  "consideration_set": ["cal","isracard"],
  "leaning_toward": "cal",
  "decision_blocker": "migration_process",
  "decision_trigger": "1.1.27 program change",
  "main_topic": "Transition_Confusion"
}
```

**Post 3** — *"Big mess in Isracard's FlyCard dept, near-impossible to reach a human, huge difference vs Cal's service..."*
```jsonc
{
  "relevance_class": "core",
  "brand_stance": [
    { "brand": "isracard", "role": "issuer", "stance": "negative", "aspect": "customer_service",
      "intensity": 3, "is_customer": true, "switch_from": "none", "switch_to": "none",
      "evidence": "near-impossible to reach a human rep, noisy, rep lacked info" },
    { "brand": "cal", "role": "issuer", "stance": "positive", "aspect": "customer_service",
      "intensity": 2, "is_customer": true, "switch_from": "none", "switch_to": "none",
      "evidence": "huge difference vs the service at Cal" }
  ],
  "in_market": false,
  "consideration_set": [],
  "leaning_toward": "none",
  "decision_blocker": "none",
  "decision_trigger": "",
  "main_topic": "Customer_Service_&_Sales_Tactics"
}
```

**The churn false-negative** — *"Bank can't issue Isracard, their call center won't call back... we'll stay with Cal."*
*(v1 dropped this as off-topic. v2 keeps it as `brand_signal` + a -isracard/+cal churn data point.)*
```jsonc
{
  "relevance_class": "brand_signal",
  "brand_stance": [
    { "brand": "isracard", "role": "issuer", "stance": "negative", "aspect": "customer_service",
      "intensity": 3, "is_customer": true, "switch_from": "isracard", "switch_to": "cal",
      "evidence": "call center won't call back; can't even get a card issued" },
    { "brand": "cal", "role": "issuer", "stance": "positive", "aspect": "customer_service",
      "intensity": 1, "is_customer": true, "switch_from": "isracard", "switch_to": "cal",
      "evidence": "we'll just stay with Cal" }
  ],
  "in_market": true,
  "consideration_set": ["cal","isracard"],
  "leaning_toward": "cal",
  "decision_blocker": "migration_process",
  "decision_trigger": "card expiring",
  "main_topic": "Customer_Service_&_Sales_Tactics"
}
```

---

## 6. Still needed outside this config (can't be fixed in the prompt)
- **Canonical alias map** for the *base* `detected_brands`/`entities`/`themes` (those stay free text;
  `brand_stance.brand` is enum-clean, but the legacy lists still drift). Apply in `workers/enrichment/normalize.py`.
- **Collection:** comments + engagement + broader/bias-tagged sources (the data-quality precondition).
- **Report layer:** dedup on `post_id`, reach-weight by engagement.
