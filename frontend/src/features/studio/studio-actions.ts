import type { LucideIcon } from 'lucide-react';
import { FileText, Target, BarChart3, Mail, Presentation, Plus } from 'lucide-react';

export type StudioActionId =
  | 'insight_report'
  | 'strategic_planning'
  | 'chart'
  | 'send_email'
  | 'deck_slides'
  | 'create_skill';

export interface StudioAction {
  id: StudioActionId;
  label: string;
  icon: LucideIcon;
  // Full Tailwind class strings so the JIT picks them up. First = icon+bg,
  // second = hover tint on the whole tile.
  iconClass: string;
  hoverClass: string;
  // Gradient for the overview-variant tile (mirrors DeliverablesPanel KIND_VISUALS).
  tileGradient: string;
  iconTint: string;
  // Full color theme for the overview-variant chunky tile. Includes border,
  // background, and the matching hover states. Using full class strings so
  // Tailwind JIT picks up every utility.
  tileTheme: string;
  // Solid icon-bubble background for the overview tile.
  iconBubble: string;
  // If omitted, the action is handled specially (e.g. opens a dialog).
  prompt?: string;
  // Visual variant — 'dashed' renders the tile as a "create new" affordance.
  variant?: 'dashed';
}

export const STUDIO_ACTIONS: StudioAction[] = [
  {
    id: 'insight_report',
    label: 'Insight Report',
    icon: FileText,
    iconClass: 'text-blue-600 bg-blue-500/10',
    hoverClass: 'hover:border-blue-500/40 hover:bg-blue-500/5',
    tileGradient: 'from-blue-500/20 via-blue-500/5 to-transparent',
    iconTint: 'text-blue-500',
    tileTheme:
      'border-blue-500/40 bg-gradient-to-br from-blue-500 to-blue-700 text-white hover:from-blue-400 hover:to-blue-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    prompt: 'Generate an insight report for the selected sources.',
  },
  {
    id: 'strategic_planning',
    label: 'Strategic Planning',
    icon: Target,
    iconClass: 'text-emerald-600 bg-emerald-500/10',
    hoverClass: 'hover:border-emerald-500/40 hover:bg-emerald-500/5',
    tileGradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    iconTint: 'text-emerald-500',
    tileTheme:
      'border-emerald-500/40 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white hover:from-emerald-400 hover:to-emerald-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    prompt:
      "Let's run a strategic planning session for this agent. Before producing a plan, ask me 2–4 short clarifying questions covering: my main objective, my target audience, the time horizon, and how I'll measure success. Use the data this agent has already collected (posts, themes, entities, sentiment) as the evidence base. Once I confirm the synthesis, publish the strategic plan as the agent's briefing using the existing briefing composition tool, structured as: objective and context, key insights from the data, recommended actions with timeline, and risks to monitor.",
  },
  {
    id: 'chart',
    label: 'Chart',
    icon: BarChart3,
    iconClass: 'text-orange-600 bg-orange-500/10',
    hoverClass: 'hover:border-orange-500/40 hover:bg-orange-500/5',
    tileGradient: 'from-orange-500/20 via-orange-500/5 to-transparent',
    iconTint: 'text-orange-500',
    tileTheme:
      'border-orange-500/40 bg-gradient-to-br from-orange-500 to-orange-700 text-white hover:from-orange-400 hover:to-orange-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    // Special: opens ChartDialog rather than sending a prompt directly.
  },
  {
    id: 'send_email',
    label: 'Send Email',
    icon: Mail,
    iconClass: 'text-pink-600 bg-pink-500/10',
    hoverClass: 'hover:border-pink-500/40 hover:bg-pink-500/5',
    tileGradient: 'from-pink-500/20 via-pink-500/5 to-transparent',
    iconTint: 'text-pink-500',
    tileTheme:
      'border-pink-500/40 bg-gradient-to-br from-pink-500 to-pink-700 text-white hover:from-pink-400 hover:to-pink-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    prompt:
      'Send me an email summary of the key findings for the selected sources. Ask me for my email address first.',
  },
  {
    id: 'deck_slides',
    label: 'Deck Slides',
    icon: Presentation,
    iconClass: 'text-amber-600 bg-amber-500/10',
    hoverClass: 'hover:border-amber-500/40 hover:bg-amber-500/5',
    tileGradient: 'from-amber-500/20 via-amber-500/5 to-transparent',
    iconTint: 'text-amber-500',
    tileTheme:
      'border-amber-500/40 bg-gradient-to-br from-amber-500 to-amber-700 text-white hover:from-amber-400 hover:to-amber-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    prompt:
      'Create a presentation deck for the selected sources. Gather the key data first, then design the slides based on what the data actually shows. If I have a saved template, ask me whether to use it.',
  },
  {
    id: 'create_skill',
    label: 'Create skill',
    icon: Plus,
    iconClass: 'text-muted-foreground border border-dashed border-muted-foreground/50 bg-transparent rounded-full',
    hoverClass: 'hover:border-foreground/40 hover:bg-muted/40',
    tileGradient: 'from-muted/40 via-muted/10 to-transparent',
    iconTint: 'text-muted-foreground',
    tileTheme:
      'border-dashed border-border/60 bg-transparent text-foreground hover:border-foreground/40 hover:bg-muted/40',
    iconBubble: 'bg-muted text-muted-foreground',
    variant: 'dashed',
  },
];
