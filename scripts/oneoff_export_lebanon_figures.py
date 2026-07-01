"""Export the 5 curated figures from the Israel-Lebanon "post suggestions"
report as watermarked PNGs into ~/Downloads.

Faithful rebuild from the same live data + the report's `valueColors` palette
(title + legend + values), matching each widget's exact config:
  AR/HE/EN  doughnut  reaction_frame by VIEWS, language filter, top4
  m1        h-stacked bar  likes by language × reaction_stance (reactions)
  m4        h-stacked bar  sum(likes) by figure × stance, top8

Each PNG gets the Scolto brand mark (navy corner-brackets + orange dot) + the
"Scolto" wordmark in the TOP-RIGHT corner.

Run:  ENVIRONMENT=development uv run --with matplotlib python scripts/oneoff_export_lebanon_figures.py
"""
import os, sys, io
from pathlib import Path

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

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

from api.deps import get_fs
from workers.shared.bq_client import BQClient
from workers.shared.sql_dedup import DEDUP_ENRICHED, DEDUP_ENGAGEMENTS

AID = "028543a6-9f57-4e4f-84b1-7f58f110a46a"
OUT = Path.home() / "Downloads"

# ── palette (from the report's reportConfig.valueColors) ─────────────────────
FRAME_C = {"betrayal_capitulation": "#dc2626", "no_real_withdrawal": "#ef4444",
           "distrust_wont_hold": "#f59e0b", "hezbollah_defeat": "#16a34a",
           "security_for_israel": "#15803d", "peace_normalization_hope": "#4ade80",
           "us_brokered_win": "#0d9488", "sovereignty_restoration": "#3b82f6",
           "factual_no_frame": "#94a3b8", "other": "#cbd5e1"}
STANCE_C = {"support": "#16a34a", "celebratory": "#86efac", "opposition": "#dc2626",
            "skeptical": "#f59e0b", "mocking": "#ea580c", "neutral_reporting": "#94a3b8",
            "other": "#cbd5e1"}
FIGST_C = {"praised": "#16a34a", "criticized": "#dc2626", "neutral": "#94a3b8"}
NAVY, ORANGE, CREAM = "#0F1F4D", "#D97757", "#F6F4EF"

STANCE_ORDER = ["support", "celebratory", "neutral_reporting", "skeptical", "mocking", "opposition"]


def pretty(s): return s.replace("_", " ").title() if s else "—"


# ── data ─────────────────────────────────────────────────────────────────────
cids = get_fs()._db.collection("agents").document(AID).get().to_dict()["collection_ids"]
inlist = ",".join(f"'{c}'" for c in cids)
bq = BQClient()


def q(sql):
    return [dict(r) for r in bq.query(sql)]


def frame_by_views(lang):
    """Doughnut: reaction_frame by views, language filter only, top4 (incl factual)."""
    rows = q(f"""WITH {DEDUP_ENRICHED}, {DEDUP_ENGAGEMENTS}
      SELECT JSON_VALUE(e.custom_fields.reaction_frame) k, SUM(g.views) v
      FROM deduped_enriched e LEFT JOIN deduped_engagements g ON e.post_id=g.post_id AND g._rn=1
      WHERE e._rn=1 AND e.collection_id IN ({inlist}) AND e.is_related_to_task AND e.language='{lang}'
        AND JSON_VALUE(e.custom_fields.reaction_frame) IS NOT NULL
      GROUP BY k ORDER BY v DESC LIMIT 4""")
    return [(r["k"], int(r["v"] or 0)) for r in rows]


def likes_lang_stance():
    rows = q(f"""WITH {DEDUP_ENRICHED}, {DEDUP_ENGAGEMENTS}
      SELECT e.language lang, JSON_VALUE(e.custom_fields.reaction_stance) st, SUM(g.likes) v
      FROM deduped_enriched e LEFT JOIN deduped_engagements g ON e.post_id=g.post_id AND g._rn=1
      WHERE e._rn=1 AND e.collection_id IN ({inlist}) AND e.is_related_to_task
        AND JSON_VALUE(e.custom_fields.event_phase)='reaction_to_declaration'
        AND e.language IN ('en','ar','he')
        AND JSON_VALUE(e.custom_fields.reaction_stance)!='other'
      GROUP BY lang, st""")
    d = {}
    for r in rows:
        d.setdefault(r["lang"], {})[r["st"]] = int(r["v"] or 0)
    return d


def figures_likes():
    rows = q(f"""WITH {DEDUP_ENRICHED}, {DEDUP_ENGAGEMENTS}
      SELECT JSON_VALUE(fig.name) name, JSON_VALUE(fig.stance) st, SUM(g.likes) v
      FROM deduped_enriched e, UNNEST(JSON_QUERY_ARRAY(e.custom_fields.figures_mentioned)) fig
      LEFT JOIN deduped_engagements g ON e.post_id=g.post_id AND g._rn=1
      WHERE e._rn=1 AND e.collection_id IN ({inlist}) AND e.is_related_to_task
      GROUP BY name, st""")
    byfig = {}
    for r in rows:
        byfig.setdefault(r["name"], {})[r["st"]] = int(r["v"] or 0)
    top = sorted(byfig.items(), key=lambda kv: -sum(kv[1].values()))[:8]
    return top


# ── Scolto watermark (mark + wordmark), pasted top-right ─────────────────────
def scolto_mark(px):
    """Transparent PNG: navy round-cap corner brackets + orange dot."""
    SS = 3
    W = px * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    navy = (15, 31, 77, 255)
    orange = (217, 119, 87, 255)
    corner, arm, stroke, dot_r = 0.2325, 0.0975, 0.070, 0.075
    sw = int(stroke * W); cap = sw / 2
    a = corner * W; b = W - a; L = arm * W
    brackets = [
        [(a, a + L), (a, a), (a + L, a)], [(b - L, a), (b, a), (b, a + L)],
        [(b, b - L), (b, b), (b - L, b)], [(a + L, b), (a, b), (a, b - L)],
    ]
    for pts in brackets:
        d.line(pts, fill=navy, width=sw, joint="curve")
        for (x, y) in pts:
            d.ellipse([x - cap, y - cap, x + cap, y + cap], fill=navy)
    r = dot_r * W; c = W / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=orange)
    return img.resize((px, px), Image.LANCZOS)


def watermark(path):
    """Paste the Scolto mark + wordmark into the reserved top-right band."""
    img = Image.open(path).convert("RGBA")
    W, H = img.size
    mark_px = max(34, H // 16)
    mark = scolto_mark(mark_px)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(mark_px * 0.82))
    except Exception:
        font = ImageFont.load_default()
    word = "Scolto"
    d = ImageDraw.Draw(img)
    tb = d.textbbox((0, 0), word, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    gap = int(mark_px * 0.30)
    margin = int(mark_px * 0.55)
    block_w = mark_px + gap + tw
    x0 = W - margin - block_w
    y0 = margin
    img.paste(mark, (x0, y0), mark)
    d.text((x0 + mark_px + gap, y0 + (mark_px - th) // 2 - tb[1]), word, font=font, fill=(15, 31, 77, 255))
    img.convert("RGB").save(path, "PNG")


# ── figure builders ──────────────────────────────────────────────────────────
def save_fig(fig, name):
    """Save WITHOUT tight bbox so the reserved top band (for the watermark) survives."""
    OUT.mkdir(exist_ok=True)
    path = OUT / name
    fig.savefig(path, dpi=200, facecolor="white")
    plt.close(fig)
    watermark(path)
    print("  wrote", path)


def doughnut(lang_label, data):
    fig = plt.figure(figsize=(6.6, 6.4))
    fig.subplots_adjust(top=0.80, bottom=0.30, left=0.06, right=0.94)
    ax = fig.add_subplot(111)
    vals = [v for _, v in data]
    colors = [FRAME_C.get(k, "#cbd5e1") for k, _ in data]
    total = sum(vals) or 1
    wedges, _ = ax.pie(vals, colors=colors, startangle=90, counterclock=False,
                       wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2))
    ax.text(0, 0, "Framing\nby reach", ha="center", va="center", fontsize=11, color="#475569")
    # title (left) + source line — both live in the reserved top band
    fig.text(0.06, 0.93, lang_label, ha="left", fontsize=22, fontweight="bold", color=NAVY)
    fig.text(0.06, 0.875, "reaction_frame · views · ~20h from signing",
             ha="left", fontsize=9, color="#94a3b8")
    leg = [f"{pretty(k)} — {v:,} ({v/total*100:.0f}%)" for k, v in data]
    ax.legend(wedges, leg, loc="upper center", bbox_to_anchor=(0.5, -0.04),
              fontsize=9.5, frameon=False, ncol=1)
    return fig


def hbar_stacked(title, rowlabels, seriesdata, series_order, colormap, subtitle):
    """rowlabels: y categories; seriesdata: {row:{series:val}}; horizontal stacked."""
    fig = plt.figure(figsize=(8.4, 0.72 * len(rowlabels) + 2.6))
    fig.subplots_adjust(top=0.82, bottom=0.16, left=0.20, right=0.97)
    ax = fig.add_subplot(111)
    ys = range(len(rowlabels))
    left = [0] * len(rowlabels)
    present = [s for s in series_order if any(seriesdata.get(r, {}).get(s) for r in rowlabels)]
    rowmax = max(sum(seriesdata.get(r, {}).values()) for r in rowlabels) or 1
    for s in present:
        widths = [seriesdata.get(r, {}).get(s, 0) for r in rowlabels]
        ax.barh(list(ys), widths, left=left, color=colormap.get(s, "#cbd5e1"),
                label=pretty(s), edgecolor="white", linewidth=0.7)
        for i, w in enumerate(widths):
            if w > rowmax * 0.06:
                ax.text(left[i] + w / 2, i, f"{w:,}", ha="center", va="center",
                        fontsize=8, color="white", fontweight="bold")
        left = [l + w for l, w in zip(left, widths)]
    ax.set_yticks(list(ys)); ax.set_yticklabels(rowlabels, fontsize=11)
    ax.invert_yaxis()
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(axis="x", labelsize=8, colors="#64748b")
    # title (left) in the reserved top band
    fig.text(0.04, 0.93, title, ha="left", fontsize=17, fontweight="bold", color=NAVY)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.10), ncol=len(present),
              fontsize=9.5, frameon=False)
    fig.text(0.04, 0.02, subtitle, ha="left", fontsize=8, color="#94a3b8")
    return fig


def main():
    print("querying…")
    AR = frame_by_views("ar"); HE = frame_by_views("he"); EN = frame_by_views("en")
    m1 = likes_lang_stance()
    m4 = figures_likes()
    print("rendering → ", OUT)

    save_fig(doughnut("Arabic", AR), "scolto_lebanon_1_arabic_frames.png")
    save_fig(doughnut("Hebrew", HE), "scolto_lebanon_2_hebrew_frames.png")
    save_fig(doughnut("English", EN), "scolto_lebanon_3_english_frames.png")

    langmap = {"en": "English", "ar": "Arabic", "he": "Hebrew"}
    rows = [langmap[l] for l in ("ar", "en", "he") if l in m1]
    sd = {langmap[l]: v for l, v in m1.items()}
    save_fig(hbar_stacked("Engagement by language & reaction stance", rows, sd,
                          STANCE_ORDER, STANCE_C, "likes · reactions only · ~20h from signing"),
             "scolto_lebanon_4_likes_by_language_stance.png")

    figrows = [pretty(n) for n, _ in m4]
    figsd = {pretty(n): v for n, v in m4}
    save_fig(hbar_stacked("Mentioned figures by stance", figrows, figsd,
                          ["praised", "neutral", "criticized"], FIGST_C,
                          "sum of post likes · top 8 figures · ~20h from signing"),
             "scolto_lebanon_5_figures_by_stance.png")
    print("done — 5 PNGs in", OUT)


if __name__ == "__main__":
    main()
