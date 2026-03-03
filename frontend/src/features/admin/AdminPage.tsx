import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useAuth } from '../../auth/useAuth.ts';
import { AdminNav, type AdminSection } from './AdminNav.tsx';
import { OverviewSection } from './sections/OverviewSection.tsx';
import { UsersSection } from './sections/UsersSection.tsx';
import { UserDetailSection } from './sections/UserDetailSection.tsx';
import { ActivitySection } from './sections/ActivitySection.tsx';
import { CollectionsSection } from './sections/CollectionsSection.tsx';
import { RevenueSection } from './sections/RevenueSection.tsx';

const SECTION_TITLES: Record<AdminSection, string> = {
  overview: 'Overview',
  users: 'Users',
  activity: 'Activity',
  collections: 'Collections',
  revenue: 'Revenue',
};

export function AdminPage() {
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const { profile } = useAuth();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Check super admin access
  if (!profile?.is_super_admin) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to access the admin dashboard.
          </p>
          <Button className="mt-4" onClick={() => navigate('/')}>
            Back to App
          </Button>
        </div>
      </div>
    );
  }

  const validSections: AdminSection[] = ['overview', 'users', 'activity', 'collections', 'revenue'];
  const activeSection: AdminSection =
    (params.section && validSections.includes(params.section as AdminSection))
      ? params.section as AdminSection
      : 'overview';

  const handleSelectSection = (section: AdminSection) => {
    setSelectedUserId(null);
    navigate(`/admin/${section}`);
  };

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
        <ShieldCheck className="h-4 w-4 text-accent-vibrant" />
        <span className="ml-2 text-sm font-medium text-foreground">Admin Dashboard</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border bg-card p-4">
          <AdminNav
            activeSection={activeSection}
            onSelect={handleSelectSection}
          />
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-8">
            {selectedUserId ? (
              <UserDetailSection
                userId={selectedUserId}
                onBack={() => setSelectedUserId(null)}
              />
            ) : (
              <>
                <h1 className="mb-6 text-xl font-semibold text-foreground">
                  {SECTION_TITLES[activeSection]}
                </h1>
                {activeSection === 'overview' && <OverviewSection />}
                {activeSection === 'users' && (
                  <UsersSection onSelectUser={setSelectedUserId} />
                )}
                {activeSection === 'activity' && <ActivitySection />}
                {activeSection === 'collections' && <CollectionsSection />}
                {activeSection === 'revenue' && <RevenueSection />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
