"""One-off: build/update the Hebrew "Brief" for the Israel-Lebanon first-reactions agent.

Updates the Explorer-tab report IN PLACE (explorer_layouts + dashboard_layouts,
fixed layout_id). RTL Hebrew, 2-column (charts left x=0/w=4, narrative right
x=4/w=8, KPI row up top).

2026-06-27 rewrite (data refresh #2): re-collected all 3 X sources →
818 posts / 798 related / 712 reactions (window 26.6 01:17 → 27.6 11:18 UTC).
Report re-angled per request to **how each side receives the agreement —
where they DIVERGE and where they CONVERGE**. Dropped the stale signing-hour
timeline (the "first hour" spike is no longer the story once discourse matured)
and the decorative theme word-cloud. Reply layer (794 replies / 14 top parents)
is from the initial wave — kept and dated, not re-fetched.

Notes on rendering (learned via Playwright):
- Text widgets render ONLY markdownContent; the widget `title` field is NOT shown.
  => every section must lead with a markdown `## header` (h2 = 16px bold in db-text).
  h1 (`#`) is reserved for the page-title widget (renders ~34px serif).
- reportConfig.canonicalization is persisted but the render-time transform is not
  wired yet (Phase 1), so cross-value merges won't visibly collapse in charts yet;
  visible language noise is cleaned at the widget level instead (topN+Others).

Run:  ENVIRONMENT=production uv run python scripts/oneoff_build_lebanon_dashboard.py [--apply]
"""
import os, sys

_root = os.path.abspath(os.path.dirname(__file__) + "/..")
sys.path.insert(0, _root)
for _f in (".env",):
    p = os.path.join(_root, _f)
    if os.path.exists(p):
        for _l in open(p):
            _l = _l.strip()
            if _l and not _l.startswith("#") and "=" in _l:
                _k, _, _v = _l.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from datetime import datetime, timezone
from api.deps import get_fs
from api.routers.dashboard_schema import SocialDashboardWidget, ReportConfig, GRID_COLS

AGENT_ID = "028543a6-9f57-4e4f-84b1-7f58f110a46a"
USER_ID = "KOgG5dtZDsaU7a96CqNK6tc0nRD2"
LAYOUT_ID = "2c8f6686a0684d119dc0777185ec4f94"
TITLE = "הסכם ישראל–לבנון: איך כל צד מקבל את ההסכם — תדרוך X"

LX, LW = 0, 4
RX, RW = 4, 8
RF = {"custom_fields": {"event_phase": ["reaction_to_declaration"]}}


def W(i, x, y, w, h, **kw): return {"i": i, "x": x, "y": y, "w": w, "h": h, **kw}
def text(i, x, y, w, h, title, md):
    return W(i, x, y, w, h, aggregation="text", chartType="table", title=title,
             markdownContent=md, manualHeight=True)
def custom(i, x, y, w, h, title, ct, cfg, desc=None, filters=None, dataSource=None):
    d = W(i, x, y, w, h, aggregation="custom", chartType=ct, title=title, customConfig=cfg)
    if desc: d["description"] = desc
    if filters: d["filters"] = filters
    if dataSource: d["dataSource"] = dataSource
    return d


class Col:
    """y-cursor so widget heights never collide when sections are reordered."""
    def __init__(self, x, w, y0): self.x, self.w, self.y = x, w, y0
    def add(self, fn, h, *a, **kw):
        wgt = fn(self.x, self.y, self.w, h, *a, **kw); self.y += h; return wgt


# ── TITLE (page title — h1) ─────────────────────────────────────────
title_w = text("t_title", 0, 0, 12, 3, "כותרת",
    "# הסכם ישראל–לבנון: איך כל צד מקבל את ההסכם\n\n"
    "**זירת השיח ב-X בשעות שלאחר ההכרזה · 26–27 ביוני 2026 · עברית · אנגלית · ערבית**\n\n"
    "ב-26.6.2026 נחתם בוושינגטון הסכם מסגרת ישראל–לבנון בתיווך אמריקאי (נסיגת צה\"ל משני אזורי פיילוט בדרום "
    "לבנון, מנגנון תיאום צבאי משולש, סיוע אמריקאי). באיסוף מרענן נאספו **818 פוסטים** ב-X בשלוש שפות; "
    "**798 רלוונטיים**, מתוכם **712 תגובות** להכרזה ו-85 סיקור מו\"מ שקדם לה. בנוסף הועשרו **794 תגובות-משנה "
    "(replies)** מתחת ל-14 הפוסטים המובילים מהגל הראשון. *כל הקריאה היא של פלטפורמת X בלבד — קהל מוטה-חדשות "
    "ופעילים, לא מדגם ייצוגי.*")

# ── KPI ROW ─────────────────────────────────────────────────────────
kpis = [
    custom("k_total", 0, 3, 3, 2, "פוסטים רלוונטיים", "number-card", {"metric": "post_count"}),
    custom("k_reach", 3, 3, 3, 2, "צפיות מצטברות", "number-card", {"metric": "view_count"}),
    custom("k_stance", 6, 3, 3, 2, "עמדה דעתנית מובילה", "number-card",
           {"metricAgg": "mode", "metric": "post_count", "categoricalField": "custom:reaction_stance"},
           filters={"custom_fields": {"event_phase": ["reaction_to_declaration"]},
                    "conditions": [{"field": "custom:reaction_stance", "operator": "isNoneOf",
                                    "value": "", "values": ["neutral_reporting"]}]}),
    custom("k_emot", 9, 3, 3, 2, "רגש דומיננטי", "number-card",
           {"metricAgg": "mode", "metric": "post_count", "categoricalField": "emotion"}),
]

# ── LEFT COLUMN — charts (divergence-first) ─────────────────────────
L = Col(LX, LW, 5)
left = [
    # 1 — THE divergence headline: same event, three language-audiences
    L.add(lambda x, y, w, h: custom("c_stance_lang", x, y, w, h, "עמדה לפי קהל-שפה (תגובות)", "bar",
           {"dimension": "language", "metric": "post_count",
            "breakdownDimension": "custom:reaction_stance", "stacked": True, "topN": 3},
           desc="ערבית ~5:1 נגד · עברית ~2.8:1 נגד · אנגלית ~1.5:1 נגד. ככל שמתקרבים לאזור — עוין יותר.",
           filters=RF), 6),
    # 2 — who speaks and how they receive it
    L.add(lambda x, y, w, h: custom("c_bloc", x, y, w, h, "מי מדבר — ואיך הוא מקבל את ההסכם", "bar",
           {"dimension": "custom:speaker_bloc", "metric": "post_count",
            "breakdownDimension": "custom:reaction_stance", "stacked": True,
            "barOrientation": "horizontal", "topN": 9},
           desc="ממסד ישראלי/אמריקאי + לבנון הרשמית = חיובי; הציבורים, חזבאללה ואיראן = שלילי. (ראו סייג מהימנות.)",
           filters=RF), 7),
    # 3 — divergence of MEANING: the frames (betrayal is shared-but-opposite)
    L.add(lambda x, y, w, h: custom("c_frame", x, y, w, h, "מסגרות הטיעון (תגובות דעתניות)", "bar",
           {"dimension": "custom:reaction_frame", "metric": "post_count",
            "barOrientation": "horizontal", "topN": 9, "includeOthers": False},
           desc="'בגידה/כניעה' (116) מובילה — אך היא מאחדת שני אויבים: ימין ישראלי + ציר חזבאללה. (דיווח עובדתי הוחרג.)",
           filters={"custom_fields": {"event_phase": ["reaction_to_declaration"]},
                    "conditions": [{"field": "custom:reaction_frame", "operator": "isNoneOf",
                                    "value": "", "values": ["factual_no_frame"]}]}), 7),
    # 4 — reach story: opposition owns engagement even when media owns views
    L.add(lambda x, y, w, h: custom("c_stance", x, y, w, h, "תמהיל עמדות — כמות מול הגעה", "bar",
           {"dimension": "custom:reaction_stance", "metric": "post_count",
            "metricToggle": ["post_count", "view_count"], "barOrientation": "horizontal", "topN": 7},
           desc="החלפה כמות↔צפיות. ההתנגדות שנייה בנפח אך ראשונה בלייקים (13.5k) — היא מה שמניע מעורבות.",
           filters=RF), 6),
    # 5 — credibility: who is the 'public'
    L.add(lambda x, y, w, h: custom("c_authority", x, y, w, h, "סוג הדובר (מהימנות)", "bar",
           {"dimension": "custom:speaker_authority", "metric": "post_count",
            "barOrientation": "horizontal", "topN": 6},
           desc="רק ~40% 'אדם פרטי'; ~35% תקשורת/עיתונאים. שכבת הפוסטים אינה 'הציבור'.",
           filters=RF), 5),
    # 6 — grassroots-only stance
    L.add(lambda x, y, w, h: custom("c_grassroots", x, y, w, h, "עמדת 'האדם הפרטי' בלבד", "bar",
           {"dimension": "custom:reaction_stance", "metric": "post_count",
            "barOrientation": "horizontal", "topN": 7},
           desc="לאחר סינון תקשורת/רשמיים/דמויות — הגראס-רוטס ~3.4:1 נגד (198 שליליות מ-159 חשבונות).",
           filters={"custom_fields": {"event_phase": ["reaction_to_declaration"],
                                      "speaker_authority": ["ordinary_user"]}}), 6),
    # 7 — figures by stance
    L.add(lambda x, y, w, h: custom("c_figs", x, y, w, h, "דמויות מרכזיות (לפי עמדה)", "bar",
           {"dimension": "custom:figures_mentioned.name", "metric": "customobj:figures_mentioned.__count",
            "breakdownDimension": "custom:figures_mentioned.stance", "barOrientation": "horizontal", "topN": 10},
           desc="נספר לכל דמות בנפרד. חזבאללה ואיראן הכי מבוקרים; נתניהו מפוצל (90 ביקורת / 28 שבח)."), 7),
    # 8 — language mix (small context)
    L.add(lambda x, y, w, h: custom("c_lang", x, y, w, h, "התפלגות שפות", "doughnut",
           {"dimension": "language", "metric": "post_count", "topN": 3, "includeOthers": True},
           desc="אנגלית עשירה ביותר (363); ערבית 270; עברית 164 — מוגבלת בהיצע."), 4),
    # 9 — phase (small context — process vs reactions)
    L.add(lambda x, y, w, h: custom("c_phase", x, y, w, h, "תגובות מול סיקור מו\"מ", "doughnut",
           {"dimension": "custom:event_phase", "metric": "post_count"},
           desc="~89% מהרלוונטיים הם תגובות להכרזה; ~11% סיקור המו\"מ שקדם לה."), 4),
]

# ── RIGHT COLUMN — narrative (each section LEADS with a `## header`) ──
R = Col(RX, RW, 5)
right = [
    R.add(lambda x, y, w, h: text("t_thesis", x, y, w, h, "תזה",
        "## 1 · התזה — הסכמה אחת, קבלות שונות\n\n"
        "> **אותו הסכם נקרא 'ניצחון ביטחוני', 'השבת ריבונות' ו'בגידה' — תלוי מי קורא.** "
        "הסיפור אינו 'בעד או נגד', אלא **כמה שונה כל צד מפרש את אותו אירוע**.\n\n"
        "מתוך **712 תגובות**, כ-43% הן **דיווח עובדתי** (306) — שכבת התקשורת. בקרב התגובות ה*דעתניות* "
        "(404), השליליות גוברות: **התנגדות 166 + ספקנות 94 + לעג 24 (=284)** מול **תמיכה 101 + חגיגיות 19 "
        "(=120)** — יחס **~2.4:1 נגד**.\n\n"
        "וכשיורדים אל **שכבת התגובות (replies)** התמונה חריפה הרבה יותר: מתוך ~624 תגובות-משנה רלוונטיות, "
        "**~5.6:1 שליליות**.\n\n"
        "*הכול בפלטפורמת X בלבד — קהל מוטה-חדשות ופעילים. אין זה סקר דעת-קהל מייצג (ראו סעיף 6).*"), 8),

    R.add(lambda x, y, w, h: text("t_diverge", x, y, w, h, "מתפצלים מול מתכנסים",
        "## 2 · איפה הצדדים מתפצלים — ואיפה הם מתכנסים\n\n"
        "**🔀 מתפצלים (אותו אירוע, פירוש הפוך):**\n"
        "* **הממסדים חיוביים — אך כל אחד מסיבה אחרת:** ישראל הרשמית = **'ניצחון ביטחוני'** (security_for_israel 58); "
        "לבנון הרשמית = **'השבת ריבונות'** (sovereignty 16); ארה\"ב = **'הישג דיפלומטי'** (us_brokered_win 30).\n"
        "* **הציבורים כולם ביקורתיים — אך מסיבות מנוגדות:** הציבור הישראלי חושש מ**'כניעה ונסיגה'**; "
        "הציבור הלבנוני וציר חזבאללה רואים **'בגידה — הסכם הקלון'** (כניעה *לאויב*).\n"
        "* **מדרג שפה:** ערבית **~5:1 נגד** → עברית **~2.8:1** → אנגלית **~1.5:1**. ככל שקרובים לאזור, עוין יותר; "
        "הזירה הבינלאומית הכי מאוזנת ותומכת.\n\n"
        "**🤝 מתכנסים (מה שכולם מסכימים עליו):**\n"
        "* **'זה לא יחזיק / אין נסיגה אמיתית'** — **161 פוסטים** (distrust_wont_hold 80 + no_real_withdrawal 81). "
        "חוסר-האמון הוא **המכנה המשותף החוצה-גבולות**: כל צד חושד שהצד השני לא יעמוד בהסכם.\n"
        "* **קרדיט לארה\"ב/רוביו** מוכר כמעט לרוחב כל המחנות (גם המבקרים).\n"
        "* **שכבת התקשורת אחידה:** ~52% מהתגובות הן דיווח חדשותי יבש — בכל השפות."), 9),

    R.add(lambda x, y, w, h: text("t_map", x, y, w, h, "מפת העמדות",
        "## 3 · מפת העמדות — מי על כל צד\n\n"
        "* **🇮🇱 ישראל — מפולגת.** הממשלה (נתניהו: \"הישג גדול\") חיובית; אך **הציבור הישראלי ~2.5:1 נגד** "
        "(85 שליליות מול 34) — קורא לזה **כניעה** (\"בושה וחרפה... הממשלה איבדה את הדרך והמצפן\").\n"
        "* **🇱🇧 לבנון הרשמית — ריבונות.** רה\"מ נאף סלאם: צעד לעבר נסיגה מלאה והשבת ריבונות (6 תמיכה / 2 ספקנות).\n"
        "* **🇱🇧 הציבור הלבנוני — ~7:1 נגד** (48 שליליות מול 7): 'הסכם הקלון' (اتفاق العار). אך זרם זה חופף "
        "ברובו למסגרת הפרו-מוקאוומה (ראו סעיף 6).\n"
        "* **חזבאללה / איראן — דחייה מוחלטת (71 + 9 התנגדות, 0 תמיכה).** קאסם: \"אין לישראל ברירה אלא נסיגה מלאה\".\n"
        "* **🇺🇸 ארה\"ב והזירה הבינלאומית — קרדיט וזהירות.** רוביו: \"ההתחלה של ההתחלה\". האנגלית הכי מאוזנת."), 7),

    R.add(lambda x, y, w, h: text("t_betrayal", x, y, w, h, "מילה אחת, שני אויבים",
        "## 4 · 'בגידה' — מילה אחת, שני אויבים מנוגדים\n\n"
        "> **המסגרת המובילה בקרב הדעתנים — 'בגידה/כניעה' (116) — מאחדת שני מחנות שונאי-תכלית.** זו מלכודת קלסית "
        "של תווית-שלילה אחת שמכסה שתי עמדות הפוכות:\n\n"
        "* **ימין ישראלי:** \"בגדנו — *ויתרנו* לחזבאללה/לבנון, נסוגונו ללא תמורה.\"\n"
        "* **ציר חזבאללה / רחוב לבנוני:** \"בגידה — *נכנעְנו לאויב*, اتفاق العار, מי שלוחץ יד לאויב פושע.\"\n\n"
        "**אותה מילה, וקטור הפוך.** מי שיקרא 'X% נגד' בלי לפרק את ההתנגדות — יתאחד בטעות שני מתנגדים שלא יושבים "
        "לעולם באותו חדר."), 6),

    R.add(lambda x, y, w, h: text("t_comments", x, y, w, h, "שכבת התגובות",
        "## 5 · שכבת התגובות — איפה הציבור באמת מדבר\n\n"
        "> **מתחת ל-14 הפוסטים הכי מדוברים מהגל הראשון הועשרו 794 תגובות-משנה (~624 רלוונטיות). זו השכבה הכי "
        "חושפת — והכי עוינת.**\n\n"
        "* **~5.6:1 שליליות** (התנגדות 265 · ספקנות 178 · לעג 53 · תמיכה 83 · חגיגיות 6).\n"
        "* **פיזור בריא:** ההתנגדות מגיעה ממאות חשבונות שונים — לא ספאם של קומץ.\n"
        "* התגובות נושאות גם **שיח שנאה אנטישמי** ניכר — אות לאיכות השיח, לא רק לעמדה.\n\n"
        "**המשמעות:** ככל שיורדים מהכותרת אל ההמון, הדחייה גוברת (פוסטים ~2.4:1 → תגובות ~5.6:1). "
        "*נתוני התגובות הם מהגל הראשון ולא רועננו.*"), 6),
    R.add(lambda x, y, w, h: custom("c_reply_stance", x, y, w, h, "עמדת התגובות (replies)", "bar",
           {"dimension": "custom:reaction_stance", "metric": "post_count",
            "barOrientation": "horizontal", "topN": 7},
           desc="~624 תגובות רלוונטיות מתחת ל-14 הפוסטים המובילים. ~5.6:1 שליליות.",
           dataSource="comments"), 5),

    R.add(lambda x, y, w, h: W("t_embeds", x, y, w, h, aggregation="embeds", chartType="embed",
      title="הפוסטים שהכי נצפו (מולטימודלי)",
      description="חי, מדורג לפי צפיות — מראה שהמערכת קראה תמונות/וידאו, לא רק טקסט.",
      embedConfig={"source": "collection", "display": "grid", "rankBy": "view_count", "count": 6}), 8),

    R.add(lambda x, y, w, h: text("t_quotes", x, y, w, h, "ציטוטים",
        "## במילותיהם (ציטוטים)\n\n"
        "**🇮🇱 ישראל — אופוזיציה (כניעה):**\n"
        "> \"בושה וחרפה — הסכם מול לבנון, נסיגת צה\"ל... הממשלה איבדה את הדרך והמצפן.\"\n\n"
        "**🇮🇱 ישראל — תמיכה:**\n"
        "> \"הסכם מסגרת זה לא שלום, אבל... צעד בכיוון הנכון.\"\n\n"
        "**🇱🇧 לבנון / חזבאללה — בגידה:**\n"
        "> \"لبنان يوقّع اتفاق العار\" (\"לבנון חותמת על הסכם הקלון\") · \"מי שלוחץ יד לאויב — פושע כמוהו.\"\n\n"
        "**🤝 מתכנסים — ספקנות חוצת-גבולות:**\n"
        "> \"This is a direct violation of the MoU. The US is not respecting Lebanon's sovereignty.\"\n\n"
        "**תגובת-משנה — תמיכה לבנונית (נדיר):**\n"
        "> \"Finally, peace. The dream of the Lebanese people who want Lebanon and Israel to live in peace.\""), 8),

    R.add(lambda x, y, w, h: text("t_bottom", x, y, w, h, "שורה תחתונה",
        "## 🔑 שורה תחתונה\n\n"
        "> **כל צד מקבל הסכם אחר.** הממסדים (ישראל/לבנון/ארה\"ב) חוגגים — כל אחד בשפת-האינטרס שלו; הרחוב — "
        "ישראלי, לבנוני וציר חזבאללה כאחד — דוחה, גם אם מסיבות מנוגדות.\n\n"
        "**הנקודה היחידה של הסכמה רחבה: אי-אמון שזה יחזיק** ('אין נסיגה אמיתית', 161 פוסטים). "
        "זו גם נקודת-הלחץ התקשורתית: כל הפרה קטנה תזין מיד את הנרטיב המשותף של 'בגידה / נסיגה מדומה'.\n\n"
        "הפער בין שכבת הפוסטים (~2.4:1 שלילי) לשכבת התגובות (~5.6:1), ובין הממסד לרחוב, הוא האזהרה: "
        "**הקריאה לפי כמות מחמיצה את עוצמת ההתנגדות הפעילה.**"), 6),

    R.add(lambda x, y, w, h: text("t_method", x, y, w, h, "מתודולוגיה",
        "## 6 · מתודולוגיה, מהימנות וסייגים\n\n"
        "**מקור:** X (טוויטר) בלבד, שלושה מקורות-שפה, איסוף מרענן 26–27.6. **818 פוסטים, 798 רלוונטיים** "
        "(96–99% לפי שפה), מועשרים בגרסה אחידה (v3). התרשימים מסוננים אוטומטית ל**תגובות בלבד** (event_phase).\n\n"
        "**אופי הפלטפורמה:** X מוטה ל**חדשות/תקשורת ופרשנות בזמן-אמת** (~52% דיווח), מדורג-לפי-טווח; שכבת ה-replies "
        "מחזיקה את הדעה העממית. רשת אחרת (אינסטגרם/טיקטוק/פייסבוק) הייתה נותנת אוכלוסייה אחרת.\n\n"
        "**⚠️ מהימנות 'הציבור' (שאלה מהותית):**\n"
        "* **זה אינו סקר ייצוגי.** X הוא תת-קבוצה פעילה/אקטיביסטית/דיאספורה — לא 'האדם ברחוב'. הרוב השקט נעדר.\n"
        "* **ציר 'סוג דובר' (speaker_authority) נפרד מהשיוך:** מבודד 'אדם פרטי' אמיתי מתקשורת/רשמיים. עדיין מסווג "
        "ע\"י מודל; במקרה ספק מעדיף 'unknown' על ניפוח 'אדם פרטי'.\n"
        "* **ההתנגדות אינה הומוגנית:** 'בגידה/כניעה' מאחדת ימין ישראלי וציר חזבאללה — שני מחנות מנוגדים (סעיף 4).\n"
        "* **אורגני מול מתואם — לא נבדק:** הצד המרגיע היחיד — **פיזור חשבונות גבוה** (198 התנגדויות/159 חשבונות).\n\n"
        "**סייגים נוספים:** תקרת היצע בעברית (~164); הטיית-תקשורת; תגובות-משנה מהגל הראשון בלבד (14 פוסטים, לא רועננו)."), 8),
]

LAYOUT = [title_w] + kpis + left + right

REPORT_CONFIG = {
    "canonicalization": [
        {"id": "cz_us", "canonical": "United States",
         "members": ["united states", "us", "usa", "u.s.", "u.s", "america", "the united states", "u.s"],
         "fields": ["entities", "themes"]},
        {"id": "cz_netanyahu", "canonical": "Netanyahu",
         "members": ["netanyahu", "benjamin netanyahu", "bibi", "נתניהו", "نتنياهو"], "fields": ["entities"]},
        {"id": "cz_rubio", "canonical": "Marco Rubio",
         "members": ["marco rubio", "rubio", "us secretary of state", "secretary of state"], "fields": ["entities"]},
        {"id": "cz_trump", "canonical": "Trump", "members": ["trump", "donald trump"], "fields": ["entities"]},
        {"id": "cz_lebarmy", "canonical": "Lebanese Army",
         "members": ["lebanese army", "lebanese armed forces", "lebanese military", "laf"], "fields": ["entities"]},
        {"id": "cz_hezb", "canonical": "Hezbollah",
         "members": ["hezbollah", "حزب الله", "חיזבאללה", "חזבאללה", "hizbollah", "hizbullah"],
         "fields": ["entities", "themes"]},
        {"id": "cz_th_agreement", "canonical": "Israel-Lebanon Framework Agreement",
         "members": ["israel lebanon framework agreement", "framework agreement", "israel lebanon agreement",
                     "diplomatic agreement", "military agreement", "peace agreement", "trilateral framework",
                     "ceasefire agreement", "israel-lebanon agreement"], "fields": ["themes"]},
        {"id": "cz_th_withdrawal", "canonical": "Military Withdrawal",
         "members": ["military withdrawal", "israeli withdrawal", "idf withdrawal", "troop withdrawal",
                     "withdrawal"], "fields": ["themes"]},
        {"id": "cz_th_negot", "canonical": "Negotiations",
         "members": ["negotiations", "diplomatic negotiations", "peace talks", "washington talks"],
         "fields": ["themes"]},
        {"id": "cz_th_ilrel", "canonical": "Israel-Lebanon Relations",
         "members": ["israel lebanon relations", "israel lebanon conflict", "israel-lebanon relations"],
         "fields": ["themes"]},
        {"id": "cz_th_security", "canonical": "Security",
         "members": ["security", "national security", "regional security", "border security"], "fields": ["themes"]},
        {"id": "cz_br_hadath", "canonical": "Al Hadath",
         "members": ["al hadath", "alhadath"], "fields": ["brands"]},
        {"id": "cz_br_arabiya", "canonical": "Al Arabiya",
         "members": ["alarabiya", "al arabiya"], "fields": ["brands"]},
        {"id": "cz_lang_he", "canonical": "he", "members": ["iw", "hebrew", "he"], "fields": ["language"]},
        {"id": "cz_lang_ar", "canonical": "ar", "members": ["arabic", "ar"], "fields": ["language"]},
        {"id": "cz_lang_en", "canonical": "en", "members": ["english", "en"], "fields": ["language"]},
    ],
    "valueColors": {
        "custom:reaction_stance": {
            "support": "#16a34a", "celebratory": "#86efac", "opposition": "#dc2626",
            "skeptical": "#f59e0b", "mocking": "#ea580c", "neutral_reporting": "#94a3b8", "other": "#cbd5e1"},
        "custom:reaction_frame": {
            "betrayal_capitulation": "#dc2626", "no_real_withdrawal": "#ef4444", "distrust_wont_hold": "#f59e0b",
            "hezbollah_defeat": "#16a34a", "security_for_israel": "#15803d", "peace_normalization_hope": "#4ade80",
            "us_brokered_win": "#0d9488", "sovereignty_restoration": "#3b82f6",
            "factual_no_frame": "#94a3b8", "other": "#cbd5e1"},
        "custom:event_phase": {"reaction_to_declaration": "#6d28d9",
                                "pre_declaration_process": "#94a3b8", "unclear": "#cbd5e1"},
        "custom:speaker_authority": {"ordinary_user": "#0d9488", "media_journalist": "#64748b",
                                      "official": "#1e3a8a", "political_figure": "#7c3aed",
                                      "influencer_activist": "#f59e0b", "unknown": "#cbd5e1"},
        "custom:figures_mentioned.stance": {"praised": "#16a34a", "criticized": "#dc2626", "neutral": "#94a3b8"},
        "sentiment": {"negative": "#dc2626", "neutral": "#94a3b8", "positive": "#16a34a"},
    },
    "computedFields": [],
}
FILTER_BAR = ["custom:event_phase", "custom:speaker_authority", "custom:reaction_stance", "language", "date_range"]


def main() -> int:
    validated = []
    for w in LAYOUT:
        obj = SocialDashboardWidget(**w)
        if obj.x + obj.w > GRID_COLS:
            raise SystemExit(f"widget {w['i']}: x+w={obj.x+obj.w} > {GRID_COLS}")
        validated.append(obj)
    if validated and all(w["x"] == 0 and w["w"] <= 4 for w in LAYOUT):
        raise SystemExit("collapsed-mobile layout rejected")
    rc = ReportConfig(**REPORT_CONFIG)
    serialized = [o.model_dump(exclude_none=True, by_alias=True) for o in validated]
    serialized_rc = rc.model_dump(exclude_none=True, by_alias=True)

    tcount = sum(1 for w in LAYOUT if w["aggregation"] == "text")
    missing_h = [w["i"] for w in LAYOUT if w["aggregation"] == "text"
                 and not w["markdownContent"].lstrip().startswith("#")]
    print(f"✓ {len(validated)} widgets valid ({tcount} text); canon groups={len(REPORT_CONFIG['canonicalization'])}; "
          f"valueColor fields={len(REPORT_CONFIG['valueColors'])}")
    print(f"  text widgets missing a leading markdown header: {missing_h or 'none'}")
    print(f"  left height={max(w['y']+w['h'] for w in left)}  right height={max(w['y']+w['h'] for w in right)}")

    if "--apply" not in sys.argv:
        print("\nDRY RUN. Re-run with --apply.")
        return 0

    fs = get_fs()
    now = datetime.now(timezone.utc).isoformat()
    fs._db.collection("explorer_layouts").document(LAYOUT_ID).set({
        "agent_id": AGENT_ID, "user_id": USER_ID, "title": TITLE, "updated_at": now,
    }, merge=True)
    fs._db.collection("dashboard_layouts").document(LAYOUT_ID).set({
        "user_id": USER_ID, "artifact_id": LAYOUT_ID, "title": TITLE,
        "layout": serialized, "filterBarFilters": FILTER_BAR, "orientation": "horizontal",
        "reportScope": None, "filterBarHidden": False, "reportConfig": serialized_rc,
        "is_template": False, "updated_at": now,
    }, merge=True)
    db = fs._db.collection("dashboard_layouts").document(LAYOUT_ID).get().to_dict()
    assert len(db["layout"]) == len(validated) and db["reportConfig"]["canonicalization"]
    print(f"\n✓ APPLIED in place. layout_id={LAYOUT_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
