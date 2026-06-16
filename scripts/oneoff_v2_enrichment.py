"""One-off: cut the Credit-Card-War agent over to the v2 enrichment config and
re-enrich its Facebook collection as a new agent version (live default).

Design + rationale: docs/research/enrichment-v2-prompt-and-schema.md

What it does:
  1. Writes the v2 enrichment_config onto the agent doc, bumps version 7 -> 8,
     and snapshots agents/{id}/versions/8.
  2. Writes the same config (+ agent_version=8) onto the collection_status doc,
     which is what the enrichment worker actually reads.
  3. Runs standalone enrichment over the FB collection. Skip key (post_id,
     agent_id, agent_version=8) finds no existing rows -> all posts enriched.
  4. Read-path dedup (agent_version DESC) makes v8 the live default; v7 rows stay
     for comparison. Revert = run a v9 with the old config if ever needed.

Usage:  uv run python scripts/oneoff_v2_enrichment.py [--dry-run]
"""

import os
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))
for _line in (_root / ".env").read_text().splitlines():
    _line = _line.strip()
    if _line and not _line.startswith("#") and "=" in _line:
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip())

from config.settings import get_settings  # noqa: E402
from workers.shared.firestore_client import FirestoreClient  # noqa: E402

AGENT_ID = "22bee852-039c-40d9-80a6-4c44d074d1c9"
COLLECTION_ID = "2151c726-625d-42d7-8598-df7c552a47b1"  # the FB / 384-post collection
NEW_VERSION = None  # computed = current agent version + 1

ENRICHMENT_CONTEXT = """\
Subject: the Israeli travel-rewards credit-card competition - the credit-card ISSUERS Cal (FlyCard / FlyAll), Isracard (FlyCard), and Max (SkyMax), and their El Al-linked travel-points cards, during the 2026 program transition.

A post is IN SCOPE if it shows ANY first-hand opinion, experience, comparison, question, or switching decision about one of these issuers or their travel cards - INCLUDING customer service, call-center, billing, card fees, the app/digital experience, points accrual/redemption, card acceptance, or migrating between issuers. A service complaint or a "I'm switching from X to Y" post IS in scope even if it never uses the words "loyalty program" - issuer-level experience and churn are the core signal.

A post is OUT OF SCOPE only when it is purely about airline operations with no issuer/card angle: El Al flight schedules, seat availability, baggage, frequent-flyer *status* mechanics, ticket changes, or generic travel logistics. El Al as an AIRLINE is context, not the subject; do not treat a flight complaint as issuer signal unless a card/issuer is actually involved.

This task is a yardstick, not a hint - judge only from what the post shows.

CANONICAL NAMING - this fixes label drift WITHOUT seeding. When (and only when) you actually observe a brand/product/network in the post, write it in EVERY output field using the canonical form below. Never add one you don't observe; normalization is not detection.
  Issuers:  Cal | Isracard | Max
  Products: FlyCard (Cal & Isracard tiers) | FlyAll (Cal) | SkyMax (Max) - map flycard / "fly card" / Hebrew variants -> FlyCard; flyall / "fly all" / Hebrew variants -> FlyAll; skymax / "sky max" -> SkyMax
  Networks: American Express | Visa | Mastercard | Diners
  Airline:  El Al (the airline / Matmid club - this is CONTEXT, not an issuer)
For free-text label fields (themes), use short lowercase singular noun phrases and reuse the aspect vocabulary terms where they fit (e.g. "fees", "customer service", "points accrual") instead of inventing near-duplicates. The enum fields (brand_stance.brand, aspect, main_topic) are the clean source of truth for reporting."""

CONTENT_TYPES = [
    "comparison_request", "recommendation", "complaint", "praise",
    "switching_decision", "migration_question", "how_to_question",
    "news_or_promo", "astroturf_warning", "other",
]

_BRAND_OPTS = ["cal", "isracard", "max", "american_express", "diners", "el_al", "other"]
_SWITCH_OPTS = ["cal", "isracard", "max", "american_express", "diners", "none"]
_ASPECT_OPTS = [
    "accrual_rate", "fees", "fx_rate", "flight_availability", "customer_service",
    "migration_process", "card_acceptance", "signup_bonus", "perks",
    "points_expiry", "app_digital", "pricing_value", "physical_card_delivery",
    "eligibility", "trust_transparency", "other",
]
_TOPIC_OPTS = [
    "Transition_Confusion", "Membership_Fees", "Points_Earning_Value",
    "Points_Redemption_&_Availability", "Customer_Service_&_Sales_Tactics",
    "App_&_Digital_Transparency", "Signup_Bonuses_&_Promos",
    "Card_Network_&_Acceptance", "Exclusivity_vs_Flexibility",
    "Brand_War_&_Trust", "Other",
]

CUSTOM_FIELDS = [
    {
        "name": "relevance_class", "type": "literal",
        "options": ["core", "brand_signal", "off_topic"],
        "description": "Three-way relevance. 'core' = about the issuer competition, card comparison, accrual/value, or the 2026 transition. 'brand_signal' = a first-hand experience/opinion about Cal/Isracard/Max OR their card (service, fees, billing, app, acceptance, churn) that is NOT a head-to-head comparison but is still real brand signal. 'off_topic' = pure airline ops / flight logistics / FF-status with no issuer or card angle. The base is_related_to_task should be true for BOTH 'core' and 'brand_signal'; false only for 'off_topic'.",
    },
    {
        "name": "brand_stance", "type": "list[object]",
        "description": "One entry per (brand x aspect) the post expresses OR implies a position on. ALWAYS assess Cal and Isracard explicitly: if the post leans for/against either - even implicitly (e.g. 'Isracard's fees are crazy, nothing special') - emit an entry; if it truly takes no position on a brand, emit nothing for it (do not invent stance). Capture comparative posts as multiple entries (e.g. +cal/service AND -isracard/service). Leave the list empty for pure how-to questions with no brand opinion.",
        "element_fields": [
            {"name": "brand", "type": "literal", "options": _BRAND_OPTS,
             "description": "Canonical brand id. Map all spelling/language variants to these (FlyCard/FlyAll/fly card/Hebrew->cal product; Isracard FlyCard->isracard; SkyMax->max; Amex->american_express; El Al->el_al)."},
            {"name": "role", "type": "literal",
             "options": ["issuer", "card_product", "airline_partner", "network", "bank", "other"],
             "description": "What this brand IS in the post: issuer (Cal/Isracard/Max), card_product (a specific FlyCard/FlyAll/SkyMax tier), airline_partner (El Al), network (Visa/MC/Amex/Diners), or bank."},
            {"name": "stance", "type": "literal",
             "options": ["positive", "negative", "considering", "neutral"],
             "description": "Poster's position toward this brand on this aspect. 'considering' = weighing/undecided about adopting or switching to it (not yet positive/negative)."},
            {"name": "aspect", "type": "literal", "options": _ASPECT_OPTS,
             "description": "The single dimension this stance is about. If the post hits two dimensions for one brand, emit two entries."},
            {"name": "intensity", "type": "int",
             "description": "Strength of the stance, 1 (mild/implicit) to 3 (strong/explicit)."},
            {"name": "is_customer", "type": "bool",
             "description": "True if the poster is or was a customer of this brand (first-hand), false if discussing from outside."},
            {"name": "switch_from", "type": "literal", "options": _SWITCH_OPTS,
             "description": "If the post describes leaving/considering leaving a brand, the brand being left; else 'none'."},
            {"name": "switch_to", "type": "literal", "options": _SWITCH_OPTS,
             "description": "If the post describes adopting/considering adopting a brand, the destination; else 'none'."},
            {"name": "evidence", "type": "str",
             "description": "Short English quote/paraphrase of the exact words that justify this stance."},
        ],
    },
    {"name": "in_market", "type": "bool",
     "description": "True if the poster is actively deciding whether to get, keep, upgrade, or switch a travel card right now (a live purchase/retention decision). This is the conversion battleground - be generous: migration-confusion and 'which should I pick' posts are in_market=true."},
    {"name": "consideration_set", "type": "list[str]",
     "description": "Canonical brand ids the poster is weighing against each other (subset of cal/isracard/max/american_express/diners). Empty if not comparing/deciding. Use the canonical ids only."},
    {"name": "leaning_toward", "type": "literal",
     "options": ["cal", "isracard", "max", "american_express", "undecided", "none"],
     "description": "If in_market, which brand the poster currently leans toward. 'undecided' if actively torn; 'none' if not in_market."},
    {"name": "decision_blocker", "type": "literal",
     "options": ["fees", "migration_process", "accrual_value", "flight_availability", "card_acceptance", "trust_transparency", "information_gap", "none"],
     "description": "The single biggest thing stopping/complicating the decision. 'information_gap' when the blocker is simply not understanding the options. 'none' if not in_market."},
    {"name": "decision_trigger", "type": "str",
     "description": "Short English note on what prompted the decision now (e.g. 'card expiring', '1.1.27 program change', 'Isracard retention call'). Empty if none."},
    {"name": "main_topic", "type": "literal", "options": _TOPIC_OPTS,
     "description": "The single DOMINANT topic (one pick; secondary drivers go in brand_stance.aspect). Transition_Confusion=what's changing/which card survives 1.1.27/FlyAll-vs-FlyCard identity/should I act now. Membership_Fees=monthly/annual fees, waivers, negotiation. Points_Earning_Value=accrual rate, points per spend, is-it-worth-it. Points_Redemption_&_Availability=using points for flights, award seat availability, destinations, gift cards. Customer_Service_&_Sales_Tactics=call center, reps, aggressive/misleading sales, retention calls, failed issuance. App_&_Digital_Transparency=seeing accrual in-app, real-time points. Signup_Bonuses_&_Promos=join bonuses, conditions, shortfalls. Card_Network_&_Acceptance=Diners/Visa/MC/Amex acceptance. Exclusivity_vs_Flexibility=STRATEGIC axis only (El Al-locked points vs fly-any-airline+cashback); not a catch-all. Brand_War_&_Trust=legal/fraud claims, competitive PR, astroturfing/paid-commenter suspicion. Other=none of the above. ALWAYS provide a value - if nothing fits, use 'Other'. Never leave this null."},
]


def build_config_patch() -> dict:
    return {
        "custom_fields": CUSTOM_FIELDS,
        "content_types": CONTENT_TYPES,
        "enrichment_context": ENRICHMENT_CONTEXT,
    }


def validate_fields():
    """Fail fast if any CustomFieldDef is malformed before touching prod."""
    from workers.enrichment.schema import CustomFieldDef
    for f in CUSTOM_FIELDS:
        CustomFieldDef(**f)
    print(f"OK: {len(CUSTOM_FIELDS)} custom fields validate against CustomFieldDef")


def main(dry_run: bool):
    validate_fields()
    settings = get_settings()
    fs = FirestoreClient(settings)

    agent = fs.get_agent(AGENT_ID) or {}
    cur_version = agent.get("version")
    global NEW_VERSION
    NEW_VERSION = (cur_version or 0) + 1
    print(f"Agent current version: {cur_version} -> target {NEW_VERSION}")

    patch = build_config_patch()
    new_enrichment_config = {**(agent.get("enrichment_config") or {}), **patch}

    if dry_run:
        print("DRY RUN - no writes. Config preview:")
        import json
        print(json.dumps(patch, ensure_ascii=False, indent=2)[:1500])
        return

    # 1) agent doc + version snapshot
    fs.update_agent(AGENT_ID, version=NEW_VERSION, enrichment_config=new_enrichment_config)
    snapshot = {
        "title": agent.get("title"),
        "data_scope": agent.get("data_scope"),
        "enrichment_config": new_enrichment_config,
        "todos": agent.get("todos"),
        "context": agent.get("context"),
        "constitution": agent.get("constitution"),
        "outputs": agent.get("outputs"),
    }
    fs.create_agent_version(AGENT_ID, NEW_VERSION, snapshot, edited_by="claude-v2-enrichment-upgrade")
    print(f"Agent bumped to v{NEW_VERSION} + snapshot written")

    # 2) collection_status: config + agent_version (worker reads from here)
    st = fs.get_collection_status(COLLECTION_ID) or {}
    new_config = {**(st.get("config") or {}), **patch}
    fs.update_collection_status(COLLECTION_ID, config=new_config, agent_version=NEW_VERSION)
    print(f"collection_status {COLLECTION_ID} updated: agent_version={NEW_VERSION}, v2 config")

    # 3) run enrichment (reads v2 config + version 8 off collection_status)
    from workers.enrichment.worker import run_enrichment
    print("Running enrichment...")
    run_enrichment(COLLECTION_ID, min_likes=0, batch_size=50)
    print("DONE")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
