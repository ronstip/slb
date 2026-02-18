import { create } from 'zustand';
import type { SessionListItem } from '../api/endpoints/sessions.ts';
import {
  listSessions,
  getSession,
  deleteSession,
} from '../api/endpoints/sessions.ts';
import { reconstructSession } from '../lib/session-reconstructor.ts';
import { useChatStore } from './chat-store.ts';
import { useStudioStore } from './studio-store.ts';
import { useSourcesStore } from './sources-store.ts';

const ACTIVE_SESSION_KEY = 'slp-active-session';

interface SessionStore {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  activeSessionTitle: string;
  isRestoring: boolean;
  isLoadingSessions: boolean;

  fetchSessions: () => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  startNewSession: () => void;
  setActiveSession: (id: string) => void;
  setActiveSessionTitle: (title: string) => void;
  removeSession: (id: string) => Promise<void>;
  reset: () => void;
}

function getStoredSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function persistSessionId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: getStoredSessionId(),
  activeSessionTitle: 'New Session',
  isRestoring: false,
  isLoadingSessions: false,

  fetchSessions: async () => {
    set({ isLoadingSessions: true });
    try {
      const sessions = await listSessions();
      set({ sessions, isLoadingSessions: false });
    } catch {
      set({ isLoadingSessions: false });
    }
  },

  restoreSession: async (id: string) => {
    set({ isRestoring: true });
    try {
      const detail = await getSession(id);
      const { messages, artifacts, selectedSourceIds } = reconstructSession(
        detail.events,
        detail.state,
      );

      // Restore all stores
      useChatStore.getState().setMessages(messages);
      useChatStore.getState().setSessionId(id);
      useStudioStore.getState().setArtifacts(artifacts);
      useSourcesStore.getState().selectByIds(selectedSourceIds);

      set({
        activeSessionId: id,
        activeSessionTitle: detail.title || 'New Session',
        isRestoring: false,
      });
      persistSessionId(id);
    } catch {
      set({ isRestoring: false });
    }
  },

  startNewSession: () => {
    useChatStore.getState().reset();
    useStudioStore.getState().reset();
    useSourcesStore.getState().deselectAll();

    set({
      activeSessionId: null,
      activeSessionTitle: 'New Session',
    });
    persistSessionId(null);

    // Re-fetch sessions so the one we just left appears in the list
    get().fetchSessions();
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id });
    persistSessionId(id);
  },

  setActiveSessionTitle: (title: string) => {
    set({ activeSessionTitle: title });
    // Also update the title in the sessions list if present
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.session_id === s.activeSessionId ? { ...sess, title } : sess,
      ),
    }));
  },

  removeSession: async (id: string) => {
    try {
      await deleteSession(id);
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.session_id !== id),
      }));
      // If we deleted the active session, reset state
      if (get().activeSessionId === id) {
        get().startNewSession();
      }
    } catch {
      // Deletion failed — leave list unchanged
    }
  },

  reset: () => {
    persistSessionId(null);
    set({
      sessions: [],
      activeSessionId: null,
      activeSessionTitle: 'New Session',
      isRestoring: false,
      isLoadingSessions: false,
    });
  },
}));
