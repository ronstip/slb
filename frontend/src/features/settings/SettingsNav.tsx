import { User, Building2, CreditCard, BarChart3, Shield, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { useUIStore } from '../../stores/ui-store.ts';

export type SettingsSection = 'account' | 'organization' | 'billing' | 'usage' | 'privacy';

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'privacy', label: 'Privacy', icon: Shield },
];

interface SettingsNavProps {
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsNav({ activeSection, onSelect }: SettingsNavProps) {
  const { signOut } = useAuth();
  const closeSettings = useUIStore((s) => s.closeSettings);

  const handleSignOut = async () => {
    closeSettings();
    await signOut();
  };

  return (
    <nav className="flex h-full flex-col gap-1">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            activeSection === id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}

      <div className="mt-auto pt-4 border-t border-border">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </nav>
  );
}
