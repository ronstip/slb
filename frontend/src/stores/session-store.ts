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
import { useAgentStore } from './agent-store.ts';

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
  touchSession: (id: string) => void;
  removeSession: (id: string) => Promise<void>;
  reset: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
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
    set({ isRestoring: true, activeSessionId: id });

    // Clear old session state immediately so the UI shows a loading state
    // instead of stale content from the previous session
    useChatStore.getState().reset();
    useStudioStore.getState().reset();
    useSourcesStore.getState().deselectAll();
    useSourcesStore.getState().setAgentSelectedSources([]);

    try {
      const detail = await getSession(id);
      const { messages, artifacts, selectedSourceIds } = reconstructSession(
        detail.events,
        detail.state,
      );

      // Restore all stores with the fetched session data
      useChatStore.getState().setMessages(messages);
      useChatStore.getState().setSessionId(id);
      useStudioStore.getState().setArtifacts(artifacts);
      useSourcesStore.getState().selectByIds(selectedSourceIds);

      // Restore task context from session state (or clear if none).
      // Must fetch tasks first so setActiveAgent can find the task in the list.
      const sessionTaskId = (detail.state?.active_task_id as string) || null;
      if (sessionTaskId) {
        await useAgentStore.getState().fetchAgents();
        useAgentStore.getState().setActiveAgent(sessionTaskId);
        // If task wasn't in the list (e.g. cross-org), load it directly
        if (!useAgentStore.getState().activeAgent) {
          await useAgentStore.getState().loadAgent(sessionTaskId);
          useAgentStore.getState().setActiveAgent(sessionTaskId);
        }
      } else {
        useAgentStore.getState().setActiveAgent(null);
      }

      set({
        activeSessionId: id,
        activeSessionTitle: detail.title || 'New Session',
        isRestoring: false,
      });
    } catch {
      set({ isRestoring: false, activeSessionId: null });
      throw new Error('Session not found');
    }
  },

  startNewSession: () => {
    useChatStore.getState().reset();
    useStudioStore.getState().reset();
    useSourcesStore.getState().deselectAll();
    useSourcesStore.getState().setAgentSelectedSources([]);
    useAgentStore.getState().setActiveAgent(null);

    set({
      activeSessionId: null,
      activeSessionTitle: 'New Session',
    });

    // Re-fetch sessions so the one we just left appears in the list
    get().fetchSessions();
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id });
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

  touchSession: (id: string) => {
    // Update updated_at locally so the session sorts to the top of the list
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.session_id === id
          ? { ...sess, updated_at: new Date().toISOString() }
          : sess,
      ),
    }));
  },

  removeSession: async (id: string) => {
    try {
      await deleteSession(id);
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.session_id !== id),
      }));
      // If the active session was deleted, the caller (SessionCard) handles navigation to `/`
    } catch {
      // Deletion failed — leave list unchanged
    }
  },

  reset: () => {
    set({
      sessions: [],
      activeSessionId: null,
      activeSessionTitle: 'New Session',
      isRestoring: false,
      isLoadingSessions: false,
    });
  },
}));
