import {
  BarChart3,
  FileText,
  LayoutDashboard,
  Mail,
  Newspaper,
  Presentation,
} from 'lucide-react';

export type DeliverableKind =
  | 'briefing'
  | 'dashboard'
  | 'slides'
  | 'email'
  | 'chart'
  | 'data_export';

export interface KindVisual {
  label: string;
  labelPlural: string;
  sublabel: string;
  icon: typeof FileText;
  tileGradient: string;
  iconTint: string;
}

export const KIND_VISUALS: Record<DeliverableKind, KindVisual> = {
  briefing: {
    label: 'Briefing',
    labelPlural: 'Briefings',
    sublabel: 'Briefing is on the way',
    icon: Newspaper,
    tileGradient: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    iconTint: 'text-indigo-500',
  },
  dashboard: {
    label: 'Dashboard',
    labelPlural: 'Dashboards',
    sublabel: 'Dashboard is on the way',
    icon: LayoutDashboard,
    tileGradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    iconTint: 'text-emerald-500',
  },
  slides: {
    label: 'Slide deck',
    labelPlural: 'Slides',
    sublabel: 'Slides are on the way',
    icon: Presentation,
    tileGradient: 'from-amber-500/20 via-amber-500/5 to-transparent',
    iconTint: 'text-amber-500',
  },
  email: {
    label: 'Email digest',
    labelPlural: 'Emails',
    sublabel: 'Email will be sent',
    icon: Mail,
    tileGradient: 'from-rose-500/20 via-rose-500/5 to-transparent',
    iconTint: 'text-rose-500',
  },
  chart: {
    label: 'Chart',
    labelPlural: 'Charts',
    sublabel: 'Chart is being generated',
    icon: BarChart3,
    tileGradient: 'from-violet-500/20 via-violet-500/5 to-transparent',
    iconTint: 'text-violet-500',
  },
  data_export: {
    label: 'Data export',
    labelPlural: 'Exports',
    sublabel: 'Export is being prepared',
    icon: FileText,
    tileGradient: 'from-slate-500/20 via-slate-500/5 to-transparent',
    iconTint: 'text-slate-500',
  },
};

export function artifactTypeToKind(
  type: 'chart' | 'data_export' | 'dashboard' | 'presentation',
): DeliverableKind {
  switch (type) {
    case 'presentation':
      return 'slides';
    case 'dashboard':
      return 'dashboard';
    case 'data_export':
      return 'data_export';
    case 'chart':
      return 'chart';
    default:
      return 'chart';
  }
}
