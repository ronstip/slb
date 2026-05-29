"""Build the v7 "Strategic Memo Brief" template.

Reverse-engineered from a hand-tuned reference brief that the customer asked
us to preserve (the Eisenkot / "Uvda" profile brief — Hebrew, X-only, 39h
window around a TV broadcast). The reference is a SHORT strategic memo with
numbered sections + an evidence appendix, NOT the version C longread and
NOT the v6 research-paper grid.

Structure (visual top-to-bottom; y/h hand-set, no auto-flow):

  HERO
    Header                         (title + 3-sentence background w/ data
                                    scope + the verified event the brief
                                    is anchored to)
    §1 Bottom line                 (2 short paras; bolds the coined concept)
    §2 The numbers picture         (3 numeric bullets — incl. engagement-
                                    paradox callout if present)
    Sentiment doughnut             (figureText explains the post% vs reach%
                                    gap and names the channels driving it)

  THE ARGUMENT
    Top narratives table           (topic_metrics, top 4 by engagement)
    §4 Operative recommendations   (3–4 imperatives; each carries verbatim
                                    sample copy / slogan in bold)
    §3 Narrative analysis          (3 h3 subsections framed as
                                    "strength that became weakness")

  EVIDENCE
    Quote appendix                 (5 supportive + 5 critical verbatim
                                    quotes, each w/ handle + views + URL)
    Stance table                   (custom dim — support / oppose / unaddressed)
    Channels table                 (channel_handle × type × posts × likes × views)
    Content-type progress-list     (content_type × sentiment, half-width)
    Reaction-narrative doughnut    (custom dim, half-width, paired w/ above)
    Embedded posts                 (X embeds mirroring appendix URLs)

What this template preserves from the reference brief — load-bearing:

  Structure
    - Numbered sections (§1 §2 §3 §4) over a Western longread.
    - Short text widgets (h≤6) — every section fits on one mobile scroll.
    - Recommendations precede the long narrative analysis. Reader gets the
      action before the diagnosis.

  Tone
    - Senior strategist memo voice.
    - Coined concepts in bold ("essence debt", "the mensch", "consciousness
      engineering"). Each section earns at most one new bolded term.
    - "Strength that became weakness" framing for narratives.
    - Verbatim slogan-style sample copy embedded in each recommendation.

  Freshness
    - Header background line names the verified event AND the time window
      around it ("39 hours around broadcast"), not just a generic week.
    - figureText on volatile charts must attribute viral lift to specific
      channels — anonymous "viral content" is banned.

  Data accuracy
    - Data-scope line up top: post count, view count, time window.
    - Every custom chart carries a figureText that says what the headline
      number means AND attributes causation to named handles / channels.
    - Appendix: 10 verbatim quotes, each w/ handle + view count + clickable
      platform URL. Mirrored 1:1 in the embed widget below the appendix.
    - Stance table uses an explicit custom dimension (yes_supportive /
      yes_anti / no) rather than inferring stance from sentiment.

Usage:
    uv run python scripts/build_dashboard_template_v7.py [--dry-run]
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

from scripts.build_dashboard_template_v3 import VOICE  # noqa: E402
from api.deps import get_fs  # noqa: E402


V7_TEMPLATE_ID = "b7e7c2d3a4f5b6c7d8e9f0a1b2c3d4e5"
OWNER_USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
AGENT_ID_FOR_EXPLORER = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"


DATA_SOURCE_PRINCIPLE = (
    "**Data-source principle.** Every number cited comes from a TVF "
    "(`window_metrics`, `topic_metrics`, `entity_metrics`, `channel_metrics`) "
    "or a `scope_posts` SELECT. Counting rows by eye, summing series mentally, "
    "normalizing percentages by arithmetic are all banned. If the source TVF "
    "is sparse for this period, say so — do not invent a baseline."
)

LOCALIZE = (
    "**Localization.** Translate every section header, label, and inline "
    "phrase into the data's dominant language. Hebrew corpus → Hebrew "
    "headers (§1 שורה תחתונה, §2 תמונת המצב במספרים, etc.). English corpus → "
    "English. Mixed-language corpus → pick the majority language and keep "
    "the entire brief consistent."
)


# ─── HERO ──────────────────────────────────────────────────────────────────


HEADER_MD = f"""# `<Subject>` — Strategic memo (`<event short-name>`, `<YYYY-MM-DD>`)

{VOICE}

{LOCALIZE}

**Agent instructions.** One H1 + one short paragraph. The paragraph names
(1) the anchoring event, (2) the verified event date, (3) the time window
around it the corpus covers, and (4) the data scope in numbers. Localize.

**Hard structure — one paragraph, three sentences max.**

1. **The anchor.** What real-world event is this brief about? What date did
   it happen? Verify the event date via web grounding — NOT from a corpus
   post date (commemorative / recap posts come days-to-weeks after the
   event and will fool you).
2. **The window.** How many hours / days of corpus around the event? Why
   this window? ("39 hours around broadcast" is a pass; "this week" is a
   fail when the event is a 90-minute show.)
3. **The numbers.** `<N>` posts, `<M>K` views, `<K>` platforms / channels.
   These three numbers must agree with what `window_metrics` returns for
   the same window — pull them, do not estimate.

**Forbidden.** Methodology terminology (`scope_posts`, `topic_metrics`,
TVF, embedding, dedupe). The word "report". "This week's brief". Any
sentence that would still be true if the anchoring event had not happened.

---

**Reference example (shape only — do not paste verbatim).**

# גדי איזנקוט — ניתוח אסטרטגי (כתבת "עובדה", 2026-05-22)

**רקע:** הדוח מנתח את התהודה הציבורית ברשת X בעקבות שידור כתבת הפרופיל
בתוכנית "עובדה" (22 במאי 2026), שליוותה את גדי איזנקוט במשך כשנה. הניתוח
מתבסס על 206 פוסטים (325.5K צפיות) שנאספו ב-39 השעות מסביב לשידור. מטרת
הדוח: למפות את הנרטיבים המרכזיים, לזהות פערים בתפיסת המועמדות ולבחון את
אפקטיביות החשיפה אל מול קהלי יעד שונים.
"""


BOTTOM_LINE_MD = f"""## 1. Bottom line

{VOICE}

**Agent instructions.** Two short paragraphs. ≤80 words total. This widget
is read in 8 seconds — every word fights for its place.

**Hard structure.**

1. **First paragraph (1–2 sentences).** State the net effect of the
   anchoring event on the subject's brand. Name one axis of strength and
   one axis of newly-created vulnerability. ("The profile cemented the
   subject as a values-based alternative but created strategic exposure
   on the operational / political axis.")
2. **Second paragraph (1–2 sentences).** Introduce the brief's **coined
   concept** — a bolded short Hebrew/English phrase the analyst is naming
   for the first time, that the rest of the memo will refer back to.
   ("`<חוב מהות>`" / "`<the essence debt>`" / "`<consciousness
   engineering>`"). The concept names the central tension; not a slogan,
   not a category. It must be specific enough that another analyst
   reading only this widget would know exactly what claim is being made.

**Anti-patterns — automatic fail.**
- Generic openers: "The broadcast generated significant discourse…",
  "Multiple narratives emerged…", "The subject faces both opportunities
  and challenges…".
- More than one coined concept per memo. Pick the strongest.
- Hedge words (`appears`, `seems`, `broadly`, `largely`). Cut them.
- Any sentence that would still be true if the period numbers were
  entirely different.

**Coining rule.** The coined concept is referenced at least once more in
§3 (Narrative analysis) and at least once in §4 (Recommendations). Three
appearances total. If it appears only here, it is decorative — replace it
or drop it.

---

**Reference example (shape only).**

## 1. שורה תחתונה

כתבת הפרופיל ב"עובדה" הצליחה לקבע את גדי איזנקוט כאלטרנטיבה שלטונית
ערכית ("המענטש"), אך יצרה פגיעות אסטרטגית משמעותית בחזית הביצועית
והפוליטית.

בעוד שהתמיכה בבסיס היא רגשית ועמוקה, הביקורת מתמקדת ב"הנדסת תודעה" וחוסר
בתוכן פוליטי מהותי. הקמפיין עומד כעת בפני **"חוב מהות"** — הצורך להוכיח
שהאדם הערכי הוא גם מנהיג עם תוכנית עבודה.
"""


NUMBERS_PICTURE_MD = f"""## 2. The numbers picture

{VOICE}

{DATA_SOURCE_PRINCIPLE}

**Agent instructions.** Three bullets. Each bullet is one specific number
with an attached causal mechanism. Bullets stack — every later bullet
adds an angle the previous did not cover.

**Bullet shapes — pick three of the four; do not repeat a shape.**

- **Shape A — Overall sentiment skew.** `<X>%` of posts are negative /
  positive. Attach the dominant frame in one short clause. ("`<70%>` of
  posts are negative, driven mainly by a `<consciousness-engineering>` /
  `<PR-stunt>` critique.")
- **Shape B — Engagement paradox.** Posts in one camp generate `<N>×` the
  engagement-per-post of posts in the other camp. Name the two channels
  doing the lift. This is the most under-noticed shape — if it holds,
  prefer it over Shape A.
- **Shape C — Lead narrative.** Topic `<X>` (`<N>` posts) vs topic `<Y>`
  (`<M>` posts). The ratio between the leading critical and leading
  supportive narrative.
- **Shape D — Reach-vs-volume gap.** Camp X has `<X>%` of posts but
  `<Y>%` of reach. Name the viral artifact (one post or one channel)
  that produced the gap.

**Each bullet must.**
- Start with a bold noun phrase naming the metric (**Overall sentiment:**,
  **Engagement paradox:**, **Lead narrative:**, **Reach-vs-volume gap:**).
- Cite at least one specific number (no "many", "most", "a lot of").
- Where applicable, name the channel / handle producing the effect.
  Anonymous "viral content" is banned in this widget.

**Forbidden.** Bullets without numbers. "Mixed sentiment". Any phrase the
agent would be tempted to use for a different subject in a different
period without editing.

---

**Reference example (shape only).**

## 2. תמונת המצב במספרים

* **סנטימנט כללי:** 70% מהפוסטים שליליים, מונע בעיקר מביקורת ממוקדת של
  "יחסי ציבור" ו"הנדסת תודעה".
* **פרדוקס המעורבות:** פוסטים התומכים באיזנקוט (נרטיב "מנהיגות אותנטית")
  מייצרים פי 2 מעורבות לפוסט מאשר פוסטים ביקורתיים — מונע מ-2 ערוצים עם
  חשיפה גבוהה (`<@channel_a>`, `<@channel_b>`).
* **נרטיב מוביל:** "יחסי ציבור פוליטיים" (55 פוסטים) לעומת "מנהיגות
  אותנטית" (20 פוסטים).
"""


# ─── THE ARGUMENT ──────────────────────────────────────────────────────────


RECOMMENDATIONS_MD = f"""## 4. Operative recommendations

{VOICE}

**Agent instructions.** 3–4 bullets. Each bullet is one move. **Each move
carries verbatim sample copy in bold** — the actual line the campaign
should ship, in the data's dominant language, ready to copy-paste.

**Hard structure — every bullet.**

- **Lead with the imperative (bold short phrase + colon).** "Repay the
  essence debt:", "Reclaim the mensch frame:", "Attack the naivete
  narrative:". This is the move's headline.
- **One sentence of body.** What the move actually does. References the
  coined concept from §1.
- **One verbatim bolded slogan** — the line that ships. In Hebrew if the
  corpus is Hebrew. **"בחדר המצב לא צריכים כריזמה, צריכים שיקול דעת"** is
  a pass; *"Position the candidate as decisive"* is a fail (it is
  guidance, not a line).

**Ranking.** Order by urgency × asymmetric upside. The first move is the
one you'd ship Monday morning if you only had one move.

**Forbidden.**
- "Increase engagement on X". "Reach younger audiences." Generic moves
  that work for any subject.
- Recommendations without a verbatim slogan.
- Moves that contradict §1's coined concept.
- Moves that contradict each other. If two moves are mutually exclusive,
  pick one.

**Three strong moves beat four padded moves.** If only three hold up,
write three.

---

**Reference example (shape only).**

## 4. המלצות אופרטיביות

* **פירעון חוב המהות:** לעבור משיח של "מי אני" (ערכים, משפחה) לשיח של
  "מה אני עושה" (ביטחון, כלכלה, משפט). יש להוציא ניירות עמדה מפורטים
  שינטרלו את הטענה ל"ואקום פוליטי".
* **ניכוס מחדש של ה"מענטש":** במקום להתנצל על היושרה, להציג אותה ככלי
  הניהולי היחיד שיכול לשקם את האמון הציבורי — **"היחיד שלא משקר לכם"**.
* **תקיפת נרטיב ה"נאיביות":** להציג את הניסיון הביטחוני העצום כמשקל נגד
  לכריזמה טלוויזיונית — **"בחדר המצב לא צריכים כריזמה, צריכים שיקול
  דעת"**.
* **ביסוס עצמאות:** הדגשת פערים או עמדות ייחודיות מול לפיד ובנט כדי
  להוכיח שהמועמד שחקן עצמאי.
"""


NARRATIVES_ANALYSIS_MD = f"""## 3. Narrative analysis — strengths that became weaknesses

{VOICE}

**Agent instructions.** Three H3 subsections. Each subsection takes one
asset the subject brought into the period and shows how the discourse
inverted it. This is the diagnostic that earns the recommendations above.

**Each subsection — exactly this shape.**

### א. `<asset / framing>` vs `<inverted reading>`

One short paragraph (40–70 words). State (a) what the subject's camp was
trying to project, (b) how the critical discourse re-read it. Quote the
critical re-reading in bold inside the paragraph — verbatim from the
corpus, ≤12 words. ("The claim, in their words: **"`<critic-line>`"**.")

If the subsection is anchored on a discrete moment (a viral clip, a
quoted line, a televised gesture), name it explicitly. Anonymous "viral
content" is banned in this widget.

**Quantitative spine.** At least one of the three subsections cites a
specific share of the critical discourse: "the `<consciousness-
engineering>` cluster is ~`<X>%` of critical posts." Pull `<X>` from
`topic_metrics`, do not estimate.

**Coined-concept tie-back.** Exactly one subsection cross-references the
§1 coined concept by name. ("This is the **essence debt** crystallized
into one televised moment.")

---

**Reference example (shape only).**

## 3. ניתוח נרטיבים: החוזקות שהופכות לחולשות

### א. "המענטש" מול "הסאקר הפוליטי"

הניסיון להציג את האנושיות והיושרה של המועמד תורגם בשיח הביקורתי לנאיביות
וחוסר הבנה של המגרש הפוליטי. הטענה המרכזית, במילותיהם: **"הוא אדם טוב,
אבל יאכלו אותו בלי מלח"**.

### ב. הנדסת תודעה וסטיב מילר

החשיפה של עבודת הייעוץ האסטרטגי הפכה לכלי נשק בידי המבקרים. השיח סביב
"הנדסת תודעה" / "שמאל מתחפש לימין" מהווה כ-18% מכלל השיח המבקר.

### ג. אירוע ה"נמנום"

הקטע בו המועמד נראה עייף הפך לוויראלי ומזין נרטיב של "חוסר כריזמה" —
**חוב המהות** מקובץ לרגע טלוויזיוני אחד.
"""


# ─── EVIDENCE ──────────────────────────────────────────────────────────────


APPENDIX_QUOTES_MD = f"""## Appendix — receipts

{VOICE}

**Agent instructions.** Exactly two sub-sections: **Supportive examples**
and **Critical examples**. Five quotes each. Pulled directly from the
corpus — no paraphrasing, no composite quotes.

**Each quote line — exactly this shape.**

* **"`<verbatim post text, ≤120 chars>`"** (`<N>K` views): `<URL>`
  *(`<handle>`)*.

**Hard rules.**

- **Verbatim.** The text inside the bold quotes is post text as it
  appears in the corpus. Translate inline ONLY if the brief language and
  the corpus language differ; otherwise leave native. Never paraphrase.
- **Citation completeness.** Every line carries view count + full
  platform URL + handle. Missing any one of the three = drop the quote
  and find another.
- **Ranking.** Within each sub-section, rank by views descending. The
  appendix is the receipts drawer; the loudest receipts go on top.
- **Mirror in the embed widget below.** The 10 URLs in this appendix
  must match the 10 URLs in the embedded-posts widget at the bottom of
  the brief, 1:1. If a quote is dropped from the appendix, drop the
  corresponding embed.

**Forbidden.** Paraphrased quotes. Quotes from outside the corpus.
"Quotes" that are actually summaries. Quotes without view counts.
Quotes whose URLs are not the canonical platform URL for the post.

---

**Reference example (shape only).**

## נספחים

### דוגמאות חיוביות:

* **"המטרה הייתה להראות את גדי האמיתי… חומרים אותנטיים ולא מתוסרטים"**
  (79.8K צפיות): https://x.com/RonenManelis/status/2056975982246887598
  *(רונן מנליס).*
* **"גדי הופיע ללא פילטרים וללא תסריט… תצוגה של אומץ ואותנטיות"**
  (1.4K צפיות): https://x.com/TheSharkLady/status/2056984505747964088
  *(TheSharkLady).*
* … (5 supportive total)

### דוגמאות שליליות:

* **"לא למדתי על דיעותיו של המועמד דבר וחצי דבר… תכנית שכולה בזבוז זמן"**
  (309 צפיות): https://x.com/GoodbeerOssi/status/2057334309233606770
  *(GoodbeerOssi).*
* **"קרטל קפלן. המועמדים הם 'מותגים'. אפס מהות. אפס אמת."**
  (1.5K צפיות): https://x.com/mcl_bgn/status/2057351319283777729
  *(mcl_bgn).*
* … (5 critical total)
"""


# ─── Widget builders ───────────────────────────────────────────────────────


def _text(i: str, md: str, y: int, h: int, w: int = 12, x: int = 0,
          title: str = "Text") -> dict:
    return {
        "i": i,
        "chartType": "table",
        "aggregation": "text",
        "markdownContent": md,
        "x": x, "y": y, "w": w, "h": h,
        "title": title,
    }


def _sentiment_doughnut() -> dict:
    """Sentiment distribution doughnut — toggleable post_count ↔ view_count.

    Matches the load-bearing sentiment widget in the reference brief. The
    `figureText` placeholder reminds the agent to attribute the post% vs
    reach% gap to specific channels (the move that makes the chart load-
    bearing instead of decorative).
    """
    return {
        "i": "v7sentdist",
        "chartType": "doughnut",
        "aggregation": "custom",
        "x": 3, "y": 12, "w": 6, "h": 8,
        "title": "Sentiment distribution",
        "customConfig": {
            "metric": "post_count",
            "dimension": "sentiment",
            "metricToggle": ["post_count", "view_count"],
        },
        "styleOverrides": {
            "seriesLabels": {
                "negative": "שלילי",
                "positive": "חיובי",
                "neutral": "נייטרלי",
            },
        },
        "figureText": (
            "[Agent: rewrite at runtime.] State the headline split AND the "
            "post%-vs-reach% gap, then attribute the gap to specific named "
            "channels. Reference shape: \"Positive posts are X% of volume "
            "but Y% of reach — the gap comes from viral posts by "
            "@<channel_a> and the official @<channel_b> account.\""
        ),
    }


def _topics_table() -> dict:
    """Topics ranked by engagement — the narrative-level evidence."""
    return {
        "i": "v7topics00",
        "chartType": "table",
        "aggregation": "custom",
        "dataSource": "topics",
        "x": 0, "y": 20, "w": 12, "h": 6,
        "title": "Top narratives",
        "customConfig": {"metric": "topic_count"},
        "tableConfig": {
            "columns": [
                {"id": "__group_0", "dimension": "topic",
                 "kind": "dimension"},
                {"id": "post_count", "metric": "post_count",
                 "display": "abs_pct", "viz": "bar"},
                {"id": "total_engagement", "metric": "total_likes",
                 "display": "abs_pct", "viz": "bar"},
            ],
            "sortBy": "total_engagement",
            "sortDir": "desc",
            "rowLimit": 4,
            "showRank": False,
        },
        "figureText": (
            "[Agent: rewrite at runtime.] Name the narrative that got the "
            "highest engagement lift AND the source — \"the supportive "
            "<authentic-leadership> topic was boosted by viral posts from "
            "@<channel_a> and the official @<channel_b> account.\" "
            "Anonymous \"viral content\" is banned."
        ),
    }


def _stance_table() -> dict:
    """Explicit stance dimension — support / oppose / not addressed.

    Uses a custom_fields dimension. Agent must define the custom field on
    the agent's enrichment_config; placeholder name here is
    `mention_of_candidacy`. Rename to match the agent's actual axis.

    Removable: agents without an explicit-stance custom field should drop
    this widget rather than infer stance from sentiment.
    """
    return {
        "i": "v7stance00",
        "removable": True,
        "chartType": "table",
        "aggregation": "custom",
        "x": 0, "y": 50, "w": 12, "h": 6,
        "title": "Direct stance toward `<position>`",
        "customConfig": {"metric": "post_count"},
        "tableConfig": {
            "columns": [
                {"id": "__group_0",
                 "dimension": "custom:<stance_field>",
                 "kind": "dimension"},
                {"id": "posts", "metric": "post_count",
                 "display": "abs_pct", "viz": "bar"},
                {"id": "likes", "metric": "like_count", "agg": "sum",
                 "display": "abs_pct", "viz": "bar"},
            ],
            "sortBy": "posts",
            "sortDir": "desc",
            "rowLimit": 10,
            "showRank": False,
        },
        "styleOverrides": {
            "seriesLabels": {
                "yes_supportive": "תומך",
                "yes_anti": "מתנגד",
                "no": "לא התייחס",
            },
        },
        "figureText": (
            "[Agent: rewrite at runtime.] Report the raw count ratio "
            "explicitly, not the percentage. Reference shape: \"Direct "
            "supportive mentions vs direct opposing mentions: 17 vs 50.\""
        ),
    }


def _channels_table() -> dict:
    """Top channels by engagement — channel-handle level evidence."""
    return {
        "i": "v7channels0",
        "chartType": "table",
        "aggregation": "custom",
        "x": 0, "y": 56, "w": 12, "h": 7,
        "title": "Top channels",
        "customConfig": {"metric": "post_count"},
        "tableConfig": {
            "columns": [
                {"id": "__group_0", "dimension": "channel_handle",
                 "kind": "dimension"},
                {"id": "dim", "dimension": "channel_type",
                 "kind": "dimension"},
                {"id": "posts", "metric": "post_count"},
                {"id": "avglikes", "metric": "like_count", "agg": "avg"},
                {"id": "avgviews", "metric": "view_count", "agg": "sum",
                 "display": "abs_pct"},
            ],
            "sortBy": "avglikes",
            "sortDir": "desc",
            "rowLimit": 15,
            "showRank": True,
        },
    }


def _content_types_progress() -> dict:
    """Content types × sentiment breakdown — half-width pair w/ reaction
    narrative doughnut.

    Removable: drop on single-content-type corpora (e.g. X-only posts with
    no replies/comments) where the breakdown is a degenerate single bar.
    """
    return {
        "i": "v7ctypes00",
        "removable": True,
        "chartType": "progress-list",
        "aggregation": "custom",
        "x": 0, "y": 63, "w": 6, "h": 6,
        "title": "Content types",
        "customConfig": {
            "metric": "post_count",
            "dimension": "content_type",
            "breakdownDimension": "sentiment",
            "metricToggle": ["view_count", "post_count"],
        },
        "styleOverrides": {
            "seriesLabels": {"comment": "reply"},
        },
    }


def _reaction_narrative_doughnut() -> dict:
    """Reaction narrative breakdown — half-width pair w/ content types.

    Removable: drop when the reaction-narrative custom field is empty for
    the agent's enrichment config.
    """
    return {
        "i": "v7reaction0",
        "removable": True,
        "chartType": "doughnut",
        "aggregation": "custom",
        "x": 6, "y": 63, "w": 6, "h": 6,
        "title": "Reaction narrative breakdown",
        "customConfig": {
            "metric": "post_count",
            "dimension": "custom:<reaction_narrative_field>",
        },
        "styleOverrides": {
            "seriesLabels": {
                "criticism": "ביקורת",
                "authentic leadership": "מנהיגות אותנטית",
                "political pr": "יחסי ציבור פוליטיים",
            },
            "seriesColors": {"authentic leadership": "#158e4a"},
        },
    }


def _embedded_posts() -> dict:
    """Embedded posts widget — 1:1 mirror of appendix URLs.

    `embedUrls` is a placeholder list — agent rewrites at runtime with the
    same 10 URLs that appear in the appendix quote widget above. If a quote
    is dropped from the appendix, drop the matching URL here.
    """
    return {
        "i": "v7embeds00",
        "chartType": "embed",
        "aggregation": "embeds",
        "x": 2, "y": 69, "w": 8, "h": 13,
        "title": "Embedded posts from appendix",
        "customConfig": {"metric": "post_count"},
        "embedUrls": [
            "<paste the 10 URLs from the appendix here, in the same order>",
        ],
    }


# ─── Layout assembly ──────────────────────────────────────────────────────


def build_layout() -> list[dict]:
    return [
        _text("v7header00", HEADER_MD, y=0, h=4),
        _text("v7bottomln", BOTTOM_LINE_MD, y=4, h=4),
        _text("v7numbers0", NUMBERS_PICTURE_MD, y=8, h=4),
        _sentiment_doughnut(),
        _topics_table(),
        _text("v7recsmds0", RECOMMENDATIONS_MD, y=26, h=5),
        _text("v7narrats0", NARRATIVES_ANALYSIS_MD, y=31, h=6),
        _text("v7appendix", APPENDIX_QUOTES_MD, y=37, h=13),
        _stance_table(),
        _channels_table(),
        _content_types_progress(),
        _reaction_narrative_doughnut(),
        _embedded_posts(),
    ]


def write_template(dry_run: bool) -> None:
    layout = build_layout()
    title = "Strategic Memo Brief (Template v7)"

    text_count = sum(1 for w in layout if w.get("aggregation") == "text")
    chart_count = len(layout) - text_count
    print(f"v7 layout: {len(layout)} widgets "
          f"({text_count} text + {chart_count} chart)")
    print(f"  max y: {max(w['y'] + w['h'] for w in layout)}")

    if dry_run:
        print("\nDRY RUN — not writing to Firestore.")
        return

    fs = get_fs()
    db = fs._db

    db.collection("dashboard_layouts").document(V7_TEMPLATE_ID).set({
        "user_id": OWNER_USER_ID,
        "artifact_id": V7_TEMPLATE_ID,
        "layout": layout,
        "filterBarFilters": [
            "sentiment", "emotion", "platform", "date_range", "themes",
            "entities", "language", "content_type", "channels",
        ],
        "filterBarHidden": True,
        "orientation": "vertical",
        "title": title,
        "is_template": True,
        # Opt-in widget-set enforcement: verify_dashboard / publish_dashboard
        # reject the final dashboard if any template widget is missing UNLESS
        # the widget carries `removable: True`. Catches the failure mode where
        # the agent calls `removals: [...]` on a core widget (e.g. §3 narrats)
        # and ends up with a structurally incomplete brief.
        "enforce_widget_set": True,
    })

    now_iso = "2026-05-29T12:00:00+00:00"
    db.collection("explorer_layouts").document(V7_TEMPLATE_ID).set({
        "agent_id": AGENT_ID_FOR_EXPLORER,
        "user_id": OWNER_USER_ID,
        "title": title,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    print(f"\nWrote v7 template: dashboard_layouts/{V7_TEMPLATE_ID}")
    print(f"Wrote v7 explorer entry: explorer_layouts/{V7_TEMPLATE_ID}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    write_template(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
