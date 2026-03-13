import { useSessionStore } from '../stores/session-store.ts';

/** Returns the app path for the current session, or `/` if none active. */
export function getAppPath(): string {
  const id = useSessionStore.getState().activeSessionId;
  return id ? `/session/${id}` : '/';
}
