import type { LucideIcon } from 'lucide-react';
import { FileText, LayoutDashboard, BarChart3, Mail, Presentation, Plus } from 'lucide-react';

export type StudioActionId =
  | 'insight_report'
  | 'dashboard'
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
    prompt: 'Generate an insight report for the selected sources.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    iconClass: 'text-purple-600 bg-purple-500/10',
    hoverClass: 'hover:border-purple-500/40 hover:bg-purple-500/5',
    prompt: 'Create an interactive dashboard for the selected sources.',
  },
  {
    id: 'chart',
    label: 'Chart',
    icon: BarChart3,
    iconClass: 'text-orange-600 bg-orange-500/10',
    hoverClass: 'hover:border-orange-500/40 hover:bg-orange-500/5',
    // Special: opens ChartDialog rather than sending a prompt directly.
  },
  {
    id: 'send_email',
    label: 'Send Email',
    icon: Mail,
    iconClass: 'text-pink-600 bg-pink-500/10',
    hoverClass: 'hover:border-pink-500/40 hover:bg-pink-500/5',
    prompt:
      'Send me an email summary of the key findings for the selected sources. Ask me for my email address first.',
  },
  {
    id: 'deck_slides',
    label: 'Deck Slides',
    icon: Presentation,
    iconClass: 'text-amber-600 bg-amber-500/10',
    hoverClass: 'hover:border-amber-500/40 hover:bg-amber-500/5',
    prompt:
      'Create a presentation deck for the selected sources. Gather the key data first, then design the slides based on what the data actually shows. If I have a saved template, ask me whether to use it.',
  },
  {
    id: 'create_skill',
    label: 'Create skill',
    icon: Plus,
    iconClass: 'text-muted-foreground border border-dashed border-muted-foreground/50 bg-transparent rounded-full',
    hoverClass: 'hover:border-foreground/40 hover:bg-muted/40',
    variant: 'dashed',
  },
];
