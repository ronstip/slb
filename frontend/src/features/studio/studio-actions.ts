import type { LucideIcon } from 'lucide-react';
import { FileText, BarChart3, Mail, Presentation, Plus } from 'lucide-react';

export type StudioActionId =
  | 'generate_report'
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
    id: 'generate_report',
    label: 'Reports',
    icon: FileText,
    iconClass: 'text-teal-600 bg-teal-500/10',
    hoverClass: 'hover:border-teal-500/40 hover:bg-teal-500/5',
    tileGradient: 'from-teal-500/20 via-teal-500/5 to-transparent',
    iconTint: 'text-teal-500',
    tileTheme:
      'border-teal-500/40 bg-gradient-to-br from-teal-500 to-teal-700 text-white hover:from-teal-400 hover:to-teal-600',
    iconBubble: 'bg-white/20 text-white ring-white/20',
    // Special: opens GenerateReportDialog (radio of Brief / Competitive Report / Weekly Report / Strategic Planning).
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
    iconClass: 'text-indigo-600 bg-indigo-500/10',
    hoverClass: 'hover:border-indigo-500/40 hover:bg-indigo-500/5',
    tileGradient: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    iconTint: 'text-indigo-500',
    tileTheme:
      'border-indigo-500/40 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white hover:from-indigo-400 hover:to-indigo-600',
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
