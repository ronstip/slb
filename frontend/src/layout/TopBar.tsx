import { BarChart3, Plus, Settings, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/useAuth.ts';
import { useUIStore } from '../stores/ui-store.ts';

export function TopBar() {
  const { user } = useAuth();
  const userId = useUIStore((s) => s.userId);
  const setUserId = useUIStore((s) => s.setUserId);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState(false);
  const [draftId, setDraftId] = useState(userId);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
        setEditingId(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const handleSaveId = () => {
    const trimmed = draftId.trim();
    if (trimmed) {
      setUserId(trimmed);
    }
    setEditingId(false);
  };

  const displayInitial = user?.displayName?.[0] || userId[0]?.toUpperCase() || '?';

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
            onClick={() => { setUserMenuOpen(!userMenuOpen); setDraftId(userId); }}
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
                  {user?.displayName || 'Dev Mode'}
                </p>
                {user?.email && (
                  <p className="text-xs text-text-secondary">{user.email}</p>
                )}

                {/* User ID — editable */}
                <div className="mt-2">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-text-tertiary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                      User ID
                    </span>
                  </div>
                  {editingId ? (
                    <div className="mt-1 flex gap-1.5">
                      <input
                        ref={inputRef}
                        type="text"
                        value={draftId}
                        onChange={(e) => setDraftId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveId();
                          if (e.key === 'Escape') setEditingId(false);
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-border-default/60 bg-bg-surface-secondary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                      />
                      <button
                        onClick={handleSaveId}
                        className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(true); setDraftId(userId); }}
                      className="mt-1 flex w-full items-center justify-between rounded-lg bg-bg-surface-secondary px-2 py-1.5 text-left transition-colors hover:bg-border-default/40"
                    >
                      <span className="truncate text-xs font-mono text-text-primary">{userId}</span>
                      <span className="shrink-0 text-[10px] text-text-tertiary">edit</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
