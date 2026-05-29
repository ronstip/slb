import { INSIGHT_REPORT_PROMPT } from './insight-report-prompt.ts';
import { CREATE_REPORT_PROMPT } from './create-report-prompt.ts';
import { DASHBOARD_REPORT_PROMPT } from './dashboard-report-prompt.ts';
import { STRATEGIC_PLANNING_PROMPT } from './strategic-planning-prompt.ts';

export type ReportTypeId =
  | 'brief'
  | 'competitive_report'
  | 'weekly_report'
  | 'strategic_planning';

export interface ReportType {
  id: ReportTypeId;
  label: string;
  description: string;
  basePrompt: string;
  framingPlaceholder: string;
  buildFramingBlock: (framing: string) => string;
  /** Tailwind color class for the radio swatch dot. */
  swatchClass: string;
}

const genericFramingBlock = (framing: string) =>
  framing
    ? `**User-supplied framing for this session:**\n${framing}\n\nTreat this framing as the primary lens. Every section, every finding, every recommendation must connect back to it. If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
    : `**No user-supplied framing.** Infer the strategic question from the agent's data scope and proceed.`;

export const REPORT_TYPES: ReportType[] = [
  {
    id: 'brief',
    label: 'Brief',
    description:
      "Senior strategist's memo anchored on a specific event — coined-concept §1 bottom line, three-bullet numbers picture, strength→weakness narrative diagnosis, operative recommendations with verbatim slogans, and a receipts appendix.",
    basePrompt: INSIGHT_REPORT_PROMPT,
    framingPlaceholder:
      'e.g. Uvda profile of Eisenkot aired 2026-05-22, 39h window around broadcast; focus on whether the human-portrait framing landed or backfired against rivals’ attack vectors. Coin one concept for the central tension.',
    buildFramingBlock: (framing: string) =>
      framing
        ? `**User-supplied framing for this session:**\n${framing}\n\nTreat this framing as the anchoring-event lens for the entire brief. The anchoring event named in the header, the coined concept introduced in §1, the strength→weakness narratives in §3, and the operative recommendations in §4 should all flow from this framing. **Verify the event date via web grounding before writing — the corpus post date is NOT the event date.** If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
        : `**No user-supplied framing.** Infer the anchoring event by scanning window_metrics / daily_metrics for the highest-density time window in the corpus and identifying the event from sample posts in that window. Then verify the event date via web grounding before writing anything.`,
    swatchClass: 'bg-blue-500',
  },
  {
    id: 'competitive_report',
    label: 'Competitive Report',
    description:
      'One-sentence thesis, three contrarian findings, risk/opportunity battle map, three shippable moves with sample copy, and a 1,500–2,000 word longread backed by supporting tables.',
    basePrompt: CREATE_REPORT_PROMPT,
    framingPlaceholder:
      "e.g. weekly intel — week of 2026-05-04 → 2026-05-11, focus on Bennett's positioning vs Netanyahu, Smotrich, Ben-Gvir; the thesis should land on whether the mental-fitness frame has consolidated, and what to ship on Monday",
    buildFramingBlock: (framing: string) =>
      framing
        ? `**User-supplied framing for this session:**\n${framing}\n\nTreat this framing as the primary lens. The thesis sentence at the top of the report, the three contrarian findings in "What you'd miss", which Battle-Map cells get flagged as critical, and the argument of the longread should all flow from this framing. If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
        : `**No user-supplied framing.** Infer the strategic question from the agent's data scope and proceed.`,
    swatchClass: 'bg-teal-500',
  },
  {
    id: 'weekly_report',
    label: 'Weekly Report',
    description:
      'Full live dashboard rendered from a template, iterated section by section. Long-form multi-section view of the data scope.',
    basePrompt: DASHBOARD_REPORT_PROMPT,
    framingPlaceholder:
      "e.g. weekly competitive brand report — week of 2026-05-04 → 2026-05-11, focus on Bennett's positioning vs Netanyahu, Smotrich, Ben-Gvir, and the Eisenkot/Liberman flank",
    buildFramingBlock: genericFramingBlock,
    swatchClass: 'bg-violet-500',
  },
  {
    id: 'strategic_planning',
    label: 'Strategic Planning',
    description: 'Open-ended strategic plan tailored to the framing you describe.',
    basePrompt: STRATEGIC_PLANNING_PROMPT,
    framingPlaceholder:
      'e.g. competitive positioning vs. peers ahead of Q3 launch — what should we own, what should we cede, what to watch for in the next 30 days',
    buildFramingBlock: genericFramingBlock,
    swatchClass: 'bg-emerald-500',
  },
];

export const DEFAULT_REPORT_TYPE_ID: ReportTypeId = 'brief';

export function getReportType(id: ReportTypeId): ReportType {
  return REPORT_TYPES.find((t) => t.id === id) ?? REPORT_TYPES[0];
}
