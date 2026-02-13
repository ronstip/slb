import { create } from 'zustand';

export interface SessionInfo {
  sessionId: string;
  title: string;
  createdAt: string;
  sourceCount: number;
}

interface SessionStore {
  sessions: SessionInfo[];
  activeSessionId: string | null;

  setActiveSession: (id: string) => void;
  addSession: (session: SessionInfo) => void;
  updateSessionTitle: (id: string, title: string) => void;
  loadSessions: () => void;
  saveSessions: () => void;
  reset: () => void;
}

const STORAGE_KEY = 'slp-sessions';

function loadFromStorage(): SessionInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: loadFromStorage(),
  activeSessionId: null,

  setActiveSession: (id) => set({ activeSessionId: id }),

  addSession: (session) =>
    set((s) => {
      const next = [session, ...s.sessions];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { sessions: next, activeSessionId: session.sessionId };
    }),

  updateSessionTitle: (id, title) =>
    set((s) => {
      const next = s.sessions.map((sess) =>
        sess.sessionId === id ? { ...sess, title } : sess,
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { sessions: next };
    }),

  loadSessions: () => set({ sessions: loadFromStorage() }),
  saveSessions: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get().sessions));
  },
  reset: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ sessions: [], activeSessionId: null });
  },
}));
