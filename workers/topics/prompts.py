"""Prompts for the two-pass LLM topic taxonomy algorithm.

Pass 1 (per-batch, parallel): extract narrow candidate topics with anchors.
Pass 2 (single call): merge near-identical candidates + emit assignment rules.

Granularity is enforced by:
  - explicit news-headline style requirement
  - mandatory entity/brand/theme anchor
  - forbidden generic topics (with annotated failure modes)
  - few-shot good examples
"""

# ---------------------------------------------------------------------------
# Pass 1 — candidate generation
# ---------------------------------------------------------------------------

PASS1_GOOD_EXAMPLES = """\
GOOD examples — each names a specific actor + specific action/stance/move, \
and the subheader carries strategic so-what:

  type: EVENT
  header:    "Smotrich faces backlash for calling October 7 a 'tactical failure'"
  subheader: "103FM remarks comparing Bennett-Abbas coalition to Oct 7 mobilize bereaved-family voices and split right-wing reaction."

  type: NARRATIVE
  header:    "Netanyahu base reframes Oct-7 accountability as opposition smear"
  subheader: "Coordinated pro-PM commentary recasts criticism as 'left-wing manipulation', dampening pressure within the coalition's right flank."

  type: DYNAMIC
  header:    "Eisenkot-Liberman merger talks stall on top-of-list dispute"
  subheader: "Stalemate keeps center-bloc fragmented and preserves Bennett's window to absorb Liberman-curious voters."

  type: EVENT
  header:    "Bennett files 2M-NIS libel suit against Silman over 'red box' recordings"
  subheader: "Suit reframes the meds-claim narrative as defamation, denying Silman's defection a clean justification ahead of Likud primaries."
"""

PASS1_BAD_EXAMPLES = """\
BAD examples (FORBIDDEN — these patterns must never appear in your output):

  "Product feedback"                          (generic, no entity, no actor)
  "Anti-Netanyahu sentiment grows"            (vague stance, no specific framing)
  "New release sparks debate among users"     (missing entity — which release?)
  "Major announcement draws mixed reactions"  (missing entity, missing actor)
  "Political commentary on the right"         (no actor, no stance)
  "Why everyone is talking about this"        (not self-explanatory, vague)
  "Reactions to the latest scandal"           (which scandal? which actors?)
"""

PASS1_PROMPT = """\
You are the editor of a daily intelligence briefing built from social-media posts. \
You receive a batch of numbered posts (each given as an AI summary of the post's \
content) and must produce candidate TOPICS that each read like a real \
news beat or strategic intelligence item.

{customer_brief}

BEAT TYPES (each candidate must be ONE of these — your choice depends on the \
posts in the batch):

  - EVENT beat (default): a specific incident, announcement, statement, or news \
event with a named actor, named action, and a definite time/place. Most \
candidates should be this type.
      Example: "Smotrich faces backlash for calling October 7 a 'tactical failure'"

  - NARRATIVE beat: a sentiment pattern, image problem, or ongoing critique/support \
storyline around a NAMED actor or bloc, when 2+ posts express overlapping framing \
without tying to a single event. Header must name the actor AND the specific stance. \
Single-post commentary that fits an existing narrative beat for the same actor \
must be assigned to that beat — do not drop it just because the post is one voice.
      Example: "Netanyahu base mobilizes against 'Oct-7 accountability' framing of opposition"
      NOT allowed: "Anti-Netanyahu sentiment grows" (too vague, no specific stance)

  - DYNAMIC beat: a strategic / coalition / power-shift storyline involving \
multiple named actors (mergers, alliances, defections, polling shifts).
      Example: "Eisenkot-Liberman merger talks stall on top-of-list dispute"

Whatever the type, set the `beat_type` field to "event", "narrative", or \
"dynamic" so the merge pass can apply the right rules.

Emit ONE candidate per distinct subject with:

  - header:    A 6-14 word headline naming a SPECIFIC entity, brand, product, \
event, named concept, or named-actor-plus-stance. Self-contained — a reader who \
saw only the header should understand what the story is.
  - subheader: ONE sentence (<= 25 words) phrased from the customer's perspective \
above — what's the so-what for THIS customer (sentiment shift, power-balance \
implication, coalition risk/opening) — without repeating the header verbatim.
  - keywords:  3-6 short phrases (words or 2-3 word terms) that characterise this \
topic. These will later be used as case-insensitive substring matchers, so prefer \
distinctive terms over common words.
  - anchor_entities, anchor_themes, anchor_brands, anchor_content_types: \
Specific values (names of actors/parties/orgs/locations for entities; topic \
phrases for themes; named outlets/products for brands; the type of content for \
content_type) that this topic clusters around. Extract them DIRECTLY from the \
posts' summaries — do not invent values that don't appear there. \
At least ONE anchor (across entities + themes + brands) is REQUIRED — \
a topic without any anchor is invalid and must be dropped.
  - source_post_indices: A list of 1-based indices of the POSTS IN THIS BATCH \
that belong to this beat. This is the MOST IMPORTANT field. \
A post belongs ONLY when its PRIMARY SUBJECT matches the beat — same specific \
event, same specific stance, same specific move. Ask: "if I had to label what \
this single post is about in one phrase, would that phrase match the beat's \
header?" If not, the post does not belong, even if it mentions a shared actor. \
At least 1 source post is REQUIRED. \
\
DO include in source_post_indices: direct coverage of the beat event/stance; \
reactions, jokes, hot-takes, and partisan spin THAT TAKE THE BEAT EVENT AS \
THEIR PRIMARY SUBJECT. \
\
DO NOT include: \
  (a) STANCE-MISMATCH posts — a post critical of X assigned to a "pro-X" \
narrative beat, or a post praising X assigned to an "anti-X" beat. These \
belong to a DIFFERENT beat (the opposing-stance beat), not to this one. \
  (b) ACTOR-OVERLAP-ONLY posts — a post primarily about Smotrich's Hebron \
visit is NOT a source for the "Smotrich's Oct 7 tactical-failure quote" beat, \
even though both name Smotrich. \
  (c) THEME-OVERLAP-ONLY posts — a post about judicial-system corruption \
should NOT be assigned to a "Netanyahu base mobilization" beat just because \
both touch the legal-system theme. \
When in doubt about a single post, OMIT it from this beat. Pass-2 will not \
recover wrongly-included posts, but pass-1 over-merging is a worse failure \
mode than pass-1 under-assignment.

CRITICAL RULES:
  1. SPECIFICITY: each topic must be about ONE narrow subject. Different events => \
different topics. Different actors-stance combinations => different topics. \
Different coalition moves => different topics. Anti-X and pro-X are DIFFERENT \
beats (different stances on the same actor).
  2. Forbidden: generic catch-all topics (see BAD examples below).
  3. Forbidden: topics without a specific entity/brand/event/actor-stance in the header.
  4. NARRATIVE-beat constraint: must have >= 2 source posts ANCHORED IN THE SAME \
STANCE to launch a new narrative beat. Single-voice opinions on an actor do \
NOT by themselves merit a narrative beat; if they don't fit any beat with a \
matching stance, leave them unassigned.
  5. Output language: English (regardless of the input post language).
  6. Better to emit MORE granular candidates than fewer broad ones. A later pass \
merges true duplicates. PRECISION OVER RECALL: a topic with 5 tightly-on-beat \
posts is more useful than a topic with 25 loosely-related posts.
  7. Each post in the batch should appear in source_post_indices of AT MOST ONE \
candidate.
  8. WHAT TO LEAVE UNASSIGNED (this is normal and expected — not every post \
needs to fit somewhere):
       - Single-voice opinions/jokes that don't match the stance of any \
candidate you have emitted.
       - Posts whose primary subject is a different event, even if they mention \
a beat actor.
       - Posts about adjacent themes (legal system, media, etc.) that don't \
take a specific beat as their subject.
       - Off-topic noise (entertainment, sports, personal/family content).
       Leaving 30-50% of posts unassigned per batch is FINE. The goal is \
high-precision beats, not maximum coverage. Pass-2 sees only your beats; posts \
you leave out simply won't be in any topic.

{good_examples}

{bad_examples}

The batch (1-indexed):

{batch}

VERIFY ASSIGNMENT (do this AFTER drafting your candidates and before returning):
For EACH candidate, re-read its header+subheader, then re-read each post you \
have placed in its source_post_indices. For each (candidate, post) pair, ask: \
\
  "If I had to summarize this single post in one phrase, would that phrase \
match the beat's header? Same event? Same stance? Same move?" \
\
If the answer is no — if the post's primary subject is different, or its \
stance opposes the beat's framing, or it only shares an actor/theme without \
being about THIS specific beat — REMOVE it from source_post_indices. Do not \
look for a different beat to put it in unless one obviously matches; \
unassigned is fine. \
\
Then check stance-mismatch one more time: are there critical posts in a \
pro-X beat or supportive posts in an anti-X beat? Move them out.

Return JSON matching the schema. Tight, specific beats with high-precision \
membership are the goal. A small beat with 3 on-target posts beats a sprawling \
beat with 30 loosely-related ones.
"""


# ---------------------------------------------------------------------------
# Pass 2 — merge + assignment rule generation
# ---------------------------------------------------------------------------

PASS2_MERGE_PROMPT = """\
You are a NEAR-DUPLICATE DETECTOR for topic candidates.

The input is a numbered list of candidates produced by parallel pass-1 batches. \
Most candidates describe DIFFERENT stories; a fraction are restatements of the \
SAME story by different batches. Each candidate carries a `beat_type`: \
"event" (specific incident), "narrative" (actor + ongoing stance/framing), or \
"dynamic" (cross-actor move). Use the type to apply the right merge rule.

Your job: output groups of candidate indices such that every candidate appears \
in EXACTLY ONE group. A group of size 1 = "no duplicate". Size 2+ = "all these \
describe the IDENTICAL story".

DEFAULT: singleton. Group only when the test below is met.

═══ MERGE RULES BY BEAT TYPE ═══

CROSS-TYPE RULE (applies first):
  - event + narrative → DO NOT MERGE (different lenses on related material).
  - event + dynamic → DO NOT MERGE.
  - narrative + dynamic → DO NOT MERGE.
  - A specific incident and a general narrative about that actor are DIFFERENT \
beats, even if the same news cycle inspired both. The event names a moment; the \
narrative names a pattern.

WITHIN-TYPE RULES:

  EVENT vs EVENT: merge only if SAME specific event/action/announcement (same \
date, same statement, same incident). Different statements by the same actor \
= different beats. Different incidents = different beats.

    SAME event (merge):
      - "Smotrich faces backlash for calling Oct 7 a 'tactical failure'"
        "Smotrich draws criticism over 'tactical event' description of Oct 7"
      - "Bennett files libel suit against Silman over recordings"
        "Bennett sues Silman/Channel 14 for 2M NIS"

    DIFFERENT events (don't merge):
      - "Smotrich's Oct 7 tactical-failure quote" vs "Smotrich's Hamas-asset \
2015 video resurfaces" — different statements, different time frames
      - "Ben-Gvir birthday-party police-attendance scandal" vs "Ben-Gvir \
politicization-of-police criticism" — specific incident vs ongoing pattern
      - "Liberman recruits Sharon Sharabi" vs "Liberman expands Yisrael \
Beiteinu with multiple security recruits" — specific recruitment vs broader \
campaign

  NARRATIVE vs NARRATIVE: merge only if SAME actor AND SAME stance/framing \
(different framings of the SAME critique or support arc).

    SAME narrative (merge):
      - "Netanyahu base mobilizes against Oct-7 accountability framing"
        "Pro-PM camp reframes Oct-7 responsibility as opposition smear"
      - "Anti-Eisenkot 'Father of the Conception' attack"
        "Right-wing campaign frames Eisenkot as Oct-7 architect"

    DIFFERENT narratives (don't merge, even same actor):
      - Anti-X-on-corruption vs Anti-X-on-security: different stances on same actor
      - Pro-X-as-security-leader vs Pro-X-as-economic-manager: different framings
      - "Golan positions as anti-Netanyahu" vs "Golan calls Smotrich \
illegitimate" — different specific positioning claims

  DYNAMIC vs DYNAMIC: merge only if SAME named cross-actor move (same merger, \
same alliance, same defection). Different merger talks = different beats.

VOLUME EXPECTATION: groups should be at least 50% of candidates. A run of 100 \
candidates with heavy duplication (multiple batches converging on the dominant \
news story) might produce 50-70 groups. A run with little duplication produces \
80-95 groups. If you produce fewer than 50 groups for 100 candidates you are \
over-merging — re-examine.

CONSTRAINTS (validated):
  - Every candidate index 1..N must appear EXACTLY ONCE across all groups.
  - Indices are 1-based and match the "Candidate {{i}}:" labels in the input.
  - When in doubt, output a singleton group.

Return JSON: {{"groups": [{{"indices": [3]}}, {{"indices": [7, 19, 42]}}, ...]}}

Candidates (numbered, each tagged with beat_type):

{candidates}
"""


def render_pass2_merge_prompt(candidates_section: str) -> str:
    return PASS2_MERGE_PROMPT.format(candidates=candidates_section)


# ---------------------------------------------------------------------------
# Pass 3 — post-hoc per-topic membership filter
# ---------------------------------------------------------------------------

PASS3_FILTER_PROMPT = """\
You are a strict beat-membership checker. You will see a topic header+subheader \
and a numbered list of post summaries currently claimed to belong to this beat. \
Decide which posts genuinely BELONG.

A post BELONGS only when its primary subject matches the beat — same specific \
event, same specific stance, same specific move.

A post is NOISE if any of these is true:
  (a) the post's primary subject is a DIFFERENT event from the beat (even if \
they share an actor's name);
  (b) the post's stance is OPPOSITE to the beat's framing (a post critical of \
X in a "pro-X" beat is noise; a post praising X in an "anti-X" beat is noise);
  (c) the post is only THEMATICALLY adjacent (same broad theme, e.g. judicial \
system or media bias) but is not about THIS specific beat.

When in doubt, prefer NOISE — high precision matters more than catching every \
borderline case.

Topic:
  header:    {header}
  subheader: {subheader}

Posts ({n} total, 1-indexed):

{posts}

Return JSON: a verdict for EVERY input index (1..{n}). Include all indices.
"""


def render_pass3_filter_prompt(
    header: str, subheader: str, summaries: list[str],
) -> str:
    posts_section = "\n\n".join(
        f"Post {i}:\n  summary: {s}" for i, s in enumerate(summaries, 1)
    )
    return PASS3_FILTER_PROMPT.format(
        header=header, subheader=subheader, n=len(summaries), posts=posts_section,
    )


DEFAULT_CUSTOMER_BRIEF = """\
CUSTOMER BRIEF
This briefing serves a generic intelligence-analyst customer. Treat any \
named-entity story as potentially in-scope; drop only obvious spam or \
content with no named actor/brand/event.
"""


def render_pass1_prompt(
    batch_section: str,
    customer_brief: str | None = None,
) -> str:
    return PASS1_PROMPT.format(
        customer_brief=(customer_brief or DEFAULT_CUSTOMER_BRIEF).strip(),
        good_examples=PASS1_GOOD_EXAMPLES,
        bad_examples=PASS1_BAD_EXAMPLES,
        batch=batch_section,
    )


def render_customer_brief(constitution: dict | None, title: str | None = None) -> str:
    """Build a CUSTOMER BRIEF block from an agent constitution.

    Constitution keys we use (any may be missing):
      - identity, perspective: who the customer is + analytical POV
      - scope_and_relevance: in-scope topics + explicit noise classes
      - mission: what the customer does with this briefing
      - methodology: any standards (trend evidence, organic-vs-paid, etc.)

    Returns plain text. We keep the original language (the LLM handles
    cross-lingual prompts fine and translation loses nuance).
    """
    if not constitution:
        return DEFAULT_CUSTOMER_BRIEF

    parts = ["CUSTOMER BRIEF"]
    if title:
        parts.append(f"Brief identity: {title}")
    fields_in_order = [
        ("identity", "Customer identity"),
        ("perspective", "Analytical perspective"),
        ("scope_and_relevance", "Scope & relevance (in-scope vs noise)"),
        ("mission", "Customer mission"),
        ("methodology", "Methodology / standards"),
    ]
    for key, label in fields_in_order:
        val = (constitution.get(key) or "").strip()
        if val:
            parts.append(f"- {label}: {val}")
    parts.append(
        "\nUse this brief to (a) drop out-of-scope posts even when they look "
        "like beats, and (b) phrase subheaders from this customer's perspective "
        "— what each beat means strategically for THEIR mission."
    )
    return "\n".join(parts)




# ---------------------------------------------------------------------------
# Section builders (kept here so prompt format and serialization stay together)
# ---------------------------------------------------------------------------


def build_pass1_batch_section(posts: list[dict]) -> str:
    """Format a sampled post batch for pass-1 consumption.

    ITERATION 1: AI-summary-only mode. Pre-extracted enrichment tags
    (entities/themes/brands/content_type) are intentionally omitted —
    the hypothesis is that the LLM groups better when it must reason
    from semantic content rather than overlapping closed-set tags.
    """
    lines = []
    for i, p in enumerate(posts, 1):
        parts = [f"Post {i}:"]
        if p.get("ai_summary"):
            parts.append(f"  summary: {p['ai_summary']}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines)


def build_pass2_candidates_section(candidates: list[dict]) -> str:
    """Format pass-1 candidates for pass-2 consumption. The `beat_type` line is
    placed first because pass-2 reads it before applying the merge rules.
    """
    lines = []
    for i, c in enumerate(candidates, 1):
        parts = [f"Candidate {i}:"]
        parts.append(f"  beat_type: {c.get('beat_type', 'event')}")
        parts.append(f"  header: {c.get('header', '')}")
        parts.append(f"  subheader: {c.get('subheader', '')}")
        if c.get("anchor_entities"):
            parts.append(f"  anchor_entities: {', '.join(c['anchor_entities'])}")
        if c.get("anchor_themes"):
            parts.append(f"  anchor_themes: {', '.join(c['anchor_themes'])}")
        if c.get("anchor_brands"):
            parts.append(f"  anchor_brands: {', '.join(c['anchor_brands'])}")
        if c.get("anchor_content_types"):
            parts.append(
                f"  anchor_content_types: {', '.join(c['anchor_content_types'])}"
            )
        if c.get("keywords"):
            parts.append(f"  keywords: {', '.join(c['keywords'])}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines)
