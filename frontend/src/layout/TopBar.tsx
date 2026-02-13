import { BarChart3, Building2, LogOut, Plus, Settings } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/useAuth.ts';

export function TopBar() {
  const { user, profile, signOut, devMode } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayInitial = user?.displayName?.[0] || profile?.display_name?.[0] || '?';

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border-default/50 bg-bg-surface px-4">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
          <BarChart3 className="h-4 w-4 text-accent" />
        </div>
        <span className="text-sm font-semibold text-text-primary">
          Social Listening
        </span>
      </div>

      {/* Session title (placeholder) */}
      <div className="ml-8 flex items-center gap-1">
        <span className="text-sm text-text-secondary">New Session</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 rounded-lg border border-border-default/60 px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm transition-colors hover:bg-bg-surface-secondary">
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>

        <button className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-bg-surface-secondary hover:text-text-primary">
          <Settings className="h-4 w-4" />
        </button>

        {/* User avatar */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-accent-subtle"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs font-medium text-accent">
                {displayInitial}
              </span>
            )}
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border-default/60 bg-bg-surface py-1 shadow-lg">
              <div className="border-b border-border-default/60 px-3 py-2.5">
                <p className="text-sm font-medium text-text-primary">
                  {user?.displayName || profile?.display_name || 'Dev Mode'}
                </p>
                {(user?.email || profile?.email) && (
                  <p className="text-xs text-text-secondary">{user?.email || profile?.email}</p>
                )}

                {/* Organization */}
                <div className="mt-2 flex items-center gap-1.5">
                  <Building2 className="h-3 w-3 text-text-tertiary" />
                  <span className="text-xs text-text-secondary">
                    {profile?.org_name || 'Personal Workspace'}
                  </span>
                </div>
              </div>

              {/* Sign Out */}
              {!devMode && (
                <button
                  onClick={() => { signOut(); setUserMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-bg-surface-secondary"
                >
                  <LogOut className="h-3.5 w-3.5 text-text-tertiary" />
                  Sign Out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
