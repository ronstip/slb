import { useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { Logo } from '../../components/Logo.tsx';
import { SettingsNav, type SettingsSection } from './SettingsNav.tsx';
import { AccountSection } from './sections/AccountSection.tsx';
import { OrganizationSection } from './sections/OrganizationSection.tsx';
import { BillingSection } from './sections/BillingSection.tsx';
import { UsageSection } from './sections/UsageSection.tsx';
import { PrivacySection } from './sections/PrivacySection.tsx';

const SECTION_TITLES: Record<SettingsSection, string> = {
  account: 'Account',
  organization: 'Organization',
  billing: 'Billing',
  usage: 'Usage',
  privacy: 'Privacy',
};

export function SettingsPage() {
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();

  // Default to 'account' if no section specified, or validate the section
  const activeSection: SettingsSection =
    (params.section && ['account', 'organization', 'billing', 'usage', 'privacy'].includes(params.section))
      ? params.section as SettingsSection
      : 'account';

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-card px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <button onClick={() => navigate('/')} className="ml-3 focus:outline-none">
          <Logo size="sm" />
        </button>
        <Separator orientation="vertical" className="mx-4 h-5" />
        <span className="text-sm font-medium text-foreground">Settings</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border bg-card p-4">
          <SettingsNav
            activeSection={activeSection}
            onSelect={(section) => navigate(`/settings/${section}`)}
          />
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
            <h1 className="mb-6 text-xl font-semibold text-foreground">
              {SECTION_TITLES[activeSection]}
            </h1>
            {activeSection === 'account' && <AccountSection />}
            {activeSection === 'organization' && <OrganizationSection />}
            {activeSection === 'billing' && <BillingSection />}
            {activeSection === 'usage' && <UsageSection />}
            {activeSection === 'privacy' && <PrivacySection />}
          </div>
        </main>
      </div>
    </div>
  );
}
