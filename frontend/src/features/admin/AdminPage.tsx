import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Logo } from '../../components/Logo.tsx';
import { getAppPath } from '../../lib/navigation.ts';
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
  const { profile, isAnonymous } = useAuth();

  if (isAnonymous) return <Navigate to="/" replace />;

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
          <Button className="mt-4" onClick={() => navigate(getAppPath())}>
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
          <span className="text-xs font-medium text-muted-foreground">Admin Dashboard</span>
        </div>

        {/* Nav */}
        <div className="flex-1 px-3">
          <AdminNav
            activeSection={activeSection}
            onSelect={handleSelectSection}
          />
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-8 py-8">
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
  );
}
