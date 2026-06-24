"""One-off: build, run, and iterate the Israeli-hospitality intelligence agent.

Multi-step working tool for an autonomous build session. Subcommands:

    validate   - construct + Pydantic-validate the full config (no mutation)
    create     - create the agent via the service layer (full path)
    dispatch   - run_agent_sources on PROD (Cloud Tasks) to fetch N posts
    monitor    - poll collection_status for the agent's collections
    sidetest   - pull collected posts from BQ, run enrich_posts with a config
                 VARIANT, print per-field distributions (no mutation, no collect)
    apply      - update_agent_with_version with the final enrichment_config

Bootstrap mirrors scripts/inspect_agent_artifacts.py (load .env, sys.path).
PROD dispatch env is set inside `dispatch` BEFORE get_settings().
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))
_env = _root / ".env"
if _env.exists():
    for _l in _env.read_text().splitlines():
        _l = _l.strip()
        if _l and not _l.startswith("#") and "=" in _l:
            _k, _, _v = _l.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
ORG_ID = "Bhtx1tzdzHan9aUZGDlJ"
GROUP_URL = "https://www.facebook.com/groups/639502990026879"
TITLE = "Israeli Hospitality Intelligence — בתי מלון בישראל"

WORKER_URL = "https://sl-worker-wyvdzmcjva-uc.a.run.app"
API_URL = "https://sl-api-wyvdzmcjva-uc.a.run.app"

# ---------------------------------------------------------------------------
# CONFIG — edit between iterations. Keep field descriptions clean (no scaffolding).
# ---------------------------------------------------------------------------

ASPECTS = [
    "overall", "cleanliness", "price_value", "staff_service", "food_breakfast",
    "room_quality", "location", "pool_spa_facilities", "booking_checkin",
    "noise", "family_suitability", "none",
]

CONSTITUTION = {
    "identity": (
        "A guest-voice intelligence analyst for the Israeli accommodation sector. "
        "Your primary source is the unfiltered 109K-member Hebrew Facebook group "
        "'מדברים על בתי מלון בישראל - ללא פילטרים' (Talking about hotels in Israel - "
        "no filters), where Israeli travellers post hotel recommendations, "
        "dis-recommendations, complaints, requests for suggestions, resale of "
        "reservations, and operator announcements."
    ),
    "mission": (
        "Turn raw, unfiltered guest word-of-mouth into market intelligence that "
        "accommodation businesses (hotels, chains, resorts, B&Bs, hosts) can act on. "
        "This group is dominated by people ASKING where to stay, so the primary "
        "signal is DEMAND and CONSIDERATION: which hotels and destinations are in "
        "active consideration, by which traveller segment, and what features guests "
        "are looking for (pool, half-board, kid entertainment, value). The secondary "
        "signal is REPUTATION: for posts that share an experience, capture each named "
        "hotel's verdict, an assumed 1-10 quality rating, the single best and single "
        "worst aspect, and how critical the mention is. Together these surface where "
        "demand is forming, which properties win/lose consideration, and the "
        "fault-lines — price/value, cleanliness, service, breakfast — that move "
        "Israeli guests' choices."
    ),
    "scope_and_relevance": (
        "In scope: any post about lodging/accommodation experiences, choices, or "
        "requests — for hotels in Israel, and Israelis discussing hotels abroad. "
        "Recommendations, complaints, praise, 'where should I stay' requests, "
        "reservation resale, and hotel/chain announcements are all relevant. "
        "Out of scope: pure flight-only or restaurant-only chatter with no lodging "
        "angle, long-term apartment rentals, and spam. A post that names a hotel OR "
        "asks for accommodation suggestions is relevant. Do not over-drop: borderline "
        "lodging chatter (general gripes about hotel prices, packing tips for a hotel "
        "stay) is relevant."
    ),
    "methodology": (
        "Read the text AND any images. Infer the implicit aspect, stance, and rating "
        "even from sarcasm, rants, jokes, or memes — a mocking post still carries a "
        "verdict and a reason; never treat it as contentless. Assume a 1-10 quality "
        "rating per hotel from tone + specifics even when no number is given "
        "(10 = glowing, 1 = a warning to avoid). Identify the destination city and "
        "country even when no specific hotel is named (e.g. 'looking for a hotel in "
        "Eilat')."
    ),
    "perspective": (
        "A neutral market analyst serving accommodation businesses. Treat both praise "
        "and complaints as equally valuable signal. Do not moralise about 'entitled "
        "guests' or take the operator's side — report what guests actually say and feel."
    ),
    "standards": (
        "Only assert a hotel name and verdict that is grounded in the post. Use "
        "canonical hotel names (strip the words 'מלון'/'Hotel' and chain boilerplate; "
        "keep the distinctive name + brand). When a request names no hotel, still "
        "capture the destination. Flag high criticality for posts with viral potential, "
        "a severe incident, or a health/safety issue (mold, pests, hygiene failures)."
    ),
}

DATA_SCOPE = {
    "sources": [
        {
            "platform": "facebook",
            "channels": [GROUP_URL],
            "keywords": [],
            "n_posts": 200,
            "time_range_days": 180,
            "geo_scope": "global",
        }
    ]
}

ENRICHMENT_CONTEXT = (
    "Source: the unfiltered Hebrew Facebook group about hotels in Israel. Posts are "
    "in Hebrew with heavy colloquialism and sarcasm; some include photos of rooms, "
    "food, or views — read them. Slang/term guide: 'כסף חזירותי' / 'מחיר מופקע' = "
    "extortionate pricing (price_value, negative); 'עובש' = mold and 'ריח' = bad smell "
    "(cleanliness/room_quality, negative); 'רעש' = noise; 'יחס'/'שירות' = staff service "
    "/ attitude; 'ארוחת בוקר' = breakfast (food_breakfast); 'חיובים נסתרים'/'תוספות' = "
    "hidden fees / add-on charges (price_value, negative); 'תמורה למחיר' = value for "
    "money; 'מחיר שפוי' = a sane/reasonable price; 'צוות בידור' = entertainment staff; "
    "'חצי פנסיון' = half-board; 'הכל כלול' = all-inclusive. "
    "For each hotel mentioned, fill country (default Israel) and city; if the "
    "post only asks about a destination with no specific hotel, leave hotel_name empty, "
    "set city/country, and stance='asking'. "
    "HOTEL NAME CANONICALIZATION: always remove the generic word Hotel / מלון / מלונות "
    "from hotel_name and keep only the brand + distinctive name — e.g. 'King Solomon' "
    "(not 'King Solomon Hotel'), 'Ayala' (not 'Hotel Ayala'), 'Caesar' (not 'Caesar "
    "Hotel'). This keeps each property counted once. "
    "If the city/area is unknown, leave city as an empty string '' — never write "
    "'Unknown' or 'Unspecified'. "
    "Pick exactly one good_aspect and one bad_aspect (the dominant praise and the "
    "dominant gripe); use 'none' when there is no praise or no gripe. "
    "overall_rank: set it ONLY when the post expresses an opinion about the hotel; "
    "leave it null when stance='asking' (a pure question carries no rating). "
    "criticality is a 1-10 integer (default 1 for routine posts). "
    "requested_features: for recommendation-request posts, list the attributes the "
    "asker wants, using ONLY this vocabulary: pool, kids_entertainment, family_friendly, "
    "half_board, all_inclusive, breakfast, spa, beach, romantic, quiet, accessibility, "
    "pet_friendly, budget_value, luxury, city_center, near_attractions. Use 'breakfast' "
    "(never 'food_breakfast' or 'food'). Do NOT put experience-quality labels here "
    "(room_quality, staff_service, cleanliness, booking_checkin, noise are aspects, not "
    "requested amenities). Leave empty for posts that are not requests. "
    "Relevance: a post is on-topic if it concerns lodging/accommodation "
    "experiences, choices, or requests (in Israel or by Israelis abroad). Do not over-"
    "exclude: general gripes about hotel prices or hotel culture ARE on-topic even "
    "without a named hotel."
)

CONTENT_TYPES = [
    "recommendation_request",  # asking the group where to stay / which hotel
    "experience_review",       # sharing a stay experience (praise and/or complaint)
    "resale_listing",          # selling/seeking a reservation on the secondary market
    "operator_post",           # a hotel/chain/host posting an offer or announcement
    "general_discussion",      # meta / opinion about hotels with no specific evaluation
    "other",
]


def _custom_fields():
    return [
        {
            "name": "hotel_mentions",
            "description": (
                "One entry per hotel referenced in the post (or per destination for a "
                "request with no named hotel). Capture the guest's verdict and why."
            ),
            "type": "list[object]",
            "element_fields": [
                {"name": "hotel_name", "description": "Canonical hotel name; empty if the post only names a destination.", "type": "str"},
                {"name": "country", "description": "Country of the hotel/destination; default Israel.", "type": "str"},
                {"name": "city", "description": "City or area (e.g. Eilat, Tel Aviv, Dead Sea, Tiberias).", "type": "str"},
                {"name": "stance", "description": "The guest's stance toward this hotel.", "type": "literal",
                 "options": ["recommend", "discourage", "neutral", "asking"]},
                {"name": "overall_rank", "description": "Assumed 1-10 quality rating (10 best, 1 a warning to avoid).", "type": "int"},
                {"name": "good_aspect", "description": "The single strongest positive aspect; 'none' if no praise.", "type": "literal", "options": ASPECTS},
                {"name": "bad_aspect", "description": "The single strongest negative aspect; 'none' if no gripe.", "type": "literal", "options": ASPECTS},
                {"name": "criticality", "description": "How critical/severe this mention is for the hotel, 1-10 (10 = severe/viral/health-safety).", "type": "int"},
            ],
        },
        {
            "name": "requested_features",
            "description": (
                "For recommendation-request posts only: the attributes the asker is "
                "looking for (e.g. pool, kids_entertainment, half_board, spa, "
                "budget_value, romantic, beach). Empty for non-request posts."
            ),
            "type": "list[str]",
        },
        {
            "name": "post_criticality",
            "description": "How critical/important the whole post is for the sector, 1-10 (urgency, reach potential, severity).",
            "type": "int",
        },
        {
            "name": "trip_context",
            "description": "The traveller segment the post is about.",
            "type": "literal",
            "options": ["family", "couples", "solo", "business", "group_event", "accessibility", "unspecified"],
        },
    ]


def build_enrichment_config():
    return {
        "content_types": CONTENT_TYPES,
        "enrichment_context": ENRICHMENT_CONTEXT,
        "custom_fields": _custom_fields(),
    }


# ---------------------------------------------------------------------------
# subcommands
# ---------------------------------------------------------------------------

def cmd_validate(args):
    from workers.enrichment.schema import CustomFieldDef

    ec = build_enrichment_config()
    n_ok = 0
    for f in ec["custom_fields"]:
        CustomFieldDef(**f)  # raises on invalid
        n_ok += 1
    print(f"[validate] {n_ok} custom fields valid against CustomFieldDef")
    print(f"[validate] content_types ({len(ec['content_types'])}): {ec['content_types']}")
    print(f"[validate] enrichment_context: {len(ec['enrichment_context'])} chars")
    print(f"[validate] constitution keys: {sorted(CONSTITUTION)}")
    print(f"[validate] data_scope: {json.dumps(DATA_SCOPE, ensure_ascii=False)}")
    print("[validate] OK")


def cmd_create(args):
    from api.services import agent_service
    from api.agent.workflow_template import build_workflow_template

    ec = build_enrichment_config()
    outputs = [{"id": "briefing", "type": "briefing", "config": {}}]
    todos = build_workflow_template(DATA_SCOPE, "one_shot", outputs=outputs, enrichment_config=ec)
    agent = agent_service.create_agent(
        user_id=USER_ID,
        title=TITLE,
        agent_type="one_shot",
        data_scope=DATA_SCOPE,
        enrichment_config=ec,
        org_id=ORG_ID,
        todos=todos,
        status=None,            # never-run; no active status
        constitution=CONSTITUTION,
        outputs=outputs,
    )
    print("[create] agent_id:", agent["agent_id"])
    print("[create] version:", agent.get("version"), "| status:", agent.get("status"))
    print("[create] todos phases:", [t.get("phase") for t in todos])


def cmd_dispatch(args):
    # PROD dispatch env MUST be set before get_settings()
    os.environ["ENVIRONMENT"] = "production"
    os.environ["WORKER_SERVICE_URL"] = WORKER_URL
    os.environ["API_SERVICE_URL"] = API_URL
    os.environ["CLOUD_TASKS_SERVICE_ACCOUNT"] = "sl-api@social-listening-pl.iam.gserviceaccount.com"
    from config.settings import get_settings
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    s = get_settings()
    print("[dispatch] is_dev:", getattr(s, "is_dev", "?"), "| worker:", getattr(s, "worker_service_url", "?"))
    from api.services import agent_service
    agent = agent_service.get_agent(args.agent_id)
    cids = agent_service.run_agent_sources(args.agent_id, agent)
    print("[dispatch] collection_ids:", cids)


def cmd_monitor(args):
    from api.deps import get_fs
    fs = get_fs()
    agent = fs.get_agent(args.agent_id)
    cids = (agent or {}).get("collection_ids", [])
    print("[monitor] collection_ids:", cids)
    for cid in cids:
        st = fs.get_collection_status(cid)
        if not st:
            print(f"  {cid}: <no status>")
            continue
        print(f"  {cid}: status={st.get('status')} collected={st.get('posts_collected')} "
              f"enriched={st.get('posts_enriched')} err={st.get('error_message')}")


def _pull_posts(collection_ids, limit):
    from workers.shared.bq_client import BQClient
    from workers.shared.sql_dedup import DEDUP_POSTS
    from workers.enrichment.schema import PostData, MediaRef
    from config.settings import get_settings
    bq = BQClient(get_settings())
    sql = f"""
    WITH {DEDUP_POSTS}
    SELECT post_id, platform, channel_handle, CAST(posted_at AS STRING) AS posted_at,
           title, content, post_url, search_keyword, media_refs
    FROM deduped_posts
    WHERE _dedup_rn = 1
    LIMIT @lim
    """
    rows = bq.query(sql, params={"collection_ids": collection_ids, "lim": limit})
    posts = []
    for r in rows:
        refs = []
        for m in (r.get("media_refs") or []):
            if isinstance(m, dict):
                refs.append(MediaRef(
                    gcs_uri=m.get("gcs_uri", "") or "",
                    original_url=m.get("original_url", "") or "",
                    media_type=m.get("media_type", "image") or "image",
                    content_type=m.get("content_type", "") or "",
                ))
        posts.append(PostData(
            post_id=r["post_id"], platform=r["platform"],
            channel_handle=r.get("channel_handle"), posted_at=r.get("posted_at"),
            title=r.get("title"), content=r.get("content"),
            post_url=r.get("post_url"), search_keyword=r.get("search_keyword"),
            media_refs=refs,
        ))
    return posts


def cmd_sidetest(args):
    from workers.enrichment.enricher import enrich_posts
    from workers.enrichment.schema import CustomFieldDef
    from api.deps import get_fs
    fs = get_fs()
    agent = fs.get_agent(args.agent_id)
    cids = (agent or {}).get("collection_ids", [])
    posts = _pull_posts(cids, args.limit)
    print(f"[sidetest] pulled {len(posts)} posts from {len(cids)} collections")
    ec = build_enrichment_config()
    cfs = [CustomFieldDef(**f) for f in ec["custom_fields"]]
    results = enrich_posts(posts, custom_fields=cfs,
                           enrichment_context=ec["enrichment_context"],
                           content_types=ec["content_types"])
    print(f"[sidetest] enriched {len(results)}/{len(posts)}")
    content_by_id = {p.post_id: (p.content or p.title or "") for p in posts}
    _distributions(results, content_by_id, dump=args.dump)


def _distributions(results, content_by_id=None, dump=0):
    content_by_id = content_by_id or {}
    rel = Counter()
    ctype = Counter()
    stance = Counter()
    good = Counter()
    bad = Counter()
    trip = Counter()
    feats = Counter()
    crit = []
    rank = []
    n_hotels = 0
    n_named = 0
    for pid, res in results:
        rel[res.is_related_to_task] += 1
        ctype[res.content_type] += 1
        cf = res.custom_fields or {}
        trip[cf.get("trip_context")] += 1
        for ft in (cf.get("requested_features") or []):
            feats[ft] += 1
        if cf.get("post_criticality") is not None:
            crit.append(cf["post_criticality"])
        for h in (cf.get("hotel_mentions") or []):
            n_hotels += 1
            if (h.get("hotel_name") or "").strip():
                n_named += 1
            stance[h.get("stance")] += 1
            good[h.get("good_aspect")] += 1
            bad[h.get("bad_aspect")] += 1
            if h.get("overall_rank") is not None:
                rank.append(h["overall_rank"])
    def avg(xs):
        return round(sum(xs) / len(xs), 2) if xs else None
    names = Counter()
    for pid, res in results:
        for h in ((res.custom_fields or {}).get("hotel_mentions") or []):
            nm = (h.get("hotel_name") or "").strip()
            if nm:
                names[nm] += 1
    print("  related:", dict(rel))
    print("  content_type:", dict(ctype.most_common()))
    print("  hotel mentions:", n_hotels, "| named:", n_named, "| destination-only:", n_hotels - n_named)
    print("  stance:", dict(stance.most_common()))
    print("  good_aspect:", dict(good.most_common()))
    print("  bad_aspect:", dict(bad.most_common()))
    print("  trip_context:", dict(trip.most_common()))
    print("  requested_features:", dict(feats.most_common(25)))
    print("  overall_rank avg:", avg(rank), "| post_criticality avg:", avg(crit))
    print("  distinct named hotels:", len(names), "| top:", dict(names.most_common(20)))

    def _show(pid, res):
        cf = res.custom_fields or {}
        print("  ---", pid, "| ct=", res.content_type, "| rel=", res.is_related_to_task,
              "| post_crit=", cf.get("post_criticality"), "| trip=", cf.get("trip_context"))
        print("     TXT:", (content_by_id.get(pid, "") or "").replace("\n", " ")[:220])
        print("     SUM:", (res.ai_summary or "")[:160])
        for h in (cf.get("hotel_mentions") or []):
            print("      hotel:", json.dumps(h, ensure_ascii=False))

    related = [(p, r) for p, r in results if r.is_related_to_task]
    unrelated = [(p, r) for p, r in results if not r.is_related_to_task]
    print("\n  == RELATED samples (precision) ==")
    for pid, res in related[:dump]:
        _show(pid, res)
    print("\n  == UNRELATED samples (false-negative check) ==")
    for pid, res in unrelated[:max(dump, 8)]:
        _show(pid, res)


def cmd_apply(args):
    """Bump the agent to the final enrichment_config AND stamp the collection_status
    config + agent_version so a subsequent re-enrich uses the final config and
    re-processes every post (skip key (post_id, agent_id, agent_version) changes)."""
    from api.services import agent_service
    from api.deps import get_fs
    ec = build_enrichment_config()
    new_v = agent_service.update_agent_with_version(
        args.agent_id, USER_ID, {"enrichment_config": ec})
    print("[apply] agent version ->", new_v)
    fs = get_fs()
    db = fs._db
    agent = fs.get_agent(args.agent_id)
    for cid in (agent or {}).get("collection_ids", []):
        db.collection("collection_status").document(cid).update({
            "config.custom_fields": ec["custom_fields"],
            "config.enrichment_context": ec["enrichment_context"],
            "config.content_types": ec["content_types"],
            "agent_version": new_v,
        })
        print("[apply] stamped collection_status", cid, "-> version", new_v, "+ final config")


def cmd_reenrich(args):
    """Re-enrich every collection on the agent with the (already-stamped) final
    config. INSERT-only into enriched_posts; readers dedupe to the newest rows."""
    from api.deps import get_fs
    from workers.enrichment import worker
    fs = get_fs()
    agent = fs.get_agent(args.agent_id)
    for cid in (agent or {}).get("collection_ids", []):
        print("[reenrich] running", cid, "...", flush=True)
        worker.run_enrichment(cid)
        st = fs.get_collection_status(cid)
        print("[reenrich] done", cid, "enriched=", (st or {}).get("posts_enriched"))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    sub.add_parser("create")
    d = sub.add_parser("dispatch"); d.add_argument("--agent-id", required=True)
    m = sub.add_parser("monitor"); m.add_argument("--agent-id", required=True)
    s = sub.add_parser("sidetest"); s.add_argument("--agent-id", required=True)
    s.add_argument("--limit", type=int, default=200); s.add_argument("--dump", type=int, default=0)
    a = sub.add_parser("apply"); a.add_argument("--agent-id", required=True)
    r = sub.add_parser("reenrich"); r.add_argument("--agent-id", required=True)
    args = ap.parse_args()
    {"validate": cmd_validate, "create": cmd_create, "dispatch": cmd_dispatch,
     "monitor": cmd_monitor, "sidetest": cmd_sidetest, "apply": cmd_apply,
     "reenrich": cmd_reenrich}[args.cmd](args)


if __name__ == "__main__":
    main()
