import { LayoutDashboard, Users, Activity, Database, DollarSign } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

export type AdminSection = 'overview' | 'users' | 'activity' | 'collections' | 'revenue';

const NAV_ITEMS: { id: AdminSection; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'collections', label: 'Collections', icon: Database },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
];

interface AdminNavProps {
  activeSection: AdminSection;
  onSelect: (section: AdminSection) => void;
}

export function AdminNav({ activeSection, onSelect }: AdminNavProps) {
  return (
    <nav className="flex h-full flex-col gap-1">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
            activeSection === id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </nav>
  );
}
