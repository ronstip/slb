import { Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/useAuth.ts';
import { Button } from '../../components/ui/button.tsx';
import { Logo } from '../../components/Logo.tsx';
import { getAppPath } from '../../lib/navigation.ts';
import { SettingsNav, type SettingsSection } from './SettingsNav.tsx';
import { AccountSection } from './sections/AccountSection.tsx';
import { OrganizationSection } from './sections/OrganizationSection.tsx';
import { BillingSection } from './sections/BillingSection.tsx';
import { UsageSection } from './sections/UsageSection.tsx';
import { AppearanceSection } from './sections/AppearanceSection.tsx';
import { PrivacySection } from './sections/PrivacySection.tsx';

const SECTION_TITLES: Record<SettingsSection, string> = {
  account: 'Account',
  organization: 'Organization',
  appearance: 'Appearance',
  billing: 'Billing',
  usage: 'Usage',
  privacy: 'Privacy',
};

export function SettingsPage() {
  const { isAnonymous } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();

  if (isAnonymous) return <Navigate to="/" replace />;

  // Default to 'account' if no section specified, or validate the section
  const activeSection: SettingsSection =
    (params.section && ['account', 'organization', 'appearance', 'billing', 'usage', 'privacy'].includes(params.section))
      ? params.section as SettingsSection
      : 'account';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-card">
        {/* Logo + Back */}
        <div className="flex items-center justify-between px-3 py-3">
          <button onClick={() => navigate(getAppPath())} className="focus:outline-none">
            <Logo size="sm" />
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => navigate(getAppPath())}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Title */}
        <div className="px-3 pb-3">
          <span className="text-xs font-medium text-muted-foreground">Settings</span>
        </div>

        {/* Nav */}
        <div className="flex-1 px-3">
          <SettingsNav
            activeSection={activeSection}
            onSelect={(section) => navigate(`/settings/${section}`)}
          />
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          <h1 className="mb-6 text-xl font-semibold text-foreground">
            {SECTION_TITLES[activeSection]}
          </h1>
          {activeSection === 'account' && <AccountSection />}
          {activeSection === 'organization' && <OrganizationSection />}
          {activeSection === 'appearance' && <AppearanceSection />}
          {activeSection === 'billing' && <BillingSection />}
          {activeSection === 'usage' && <UsageSection />}
          {activeSection === 'privacy' && <PrivacySection />}
        </div>
      </main>
    </div>
  );
}
