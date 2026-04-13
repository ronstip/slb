import { apiGet, apiDelete } from '../client.ts';

// --- Types ---

export interface SessionListItem {
  session_id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  preview: string | null;
  task_id?: string | null;
}

/** Raw ADK event shape from Firestore events_json */
export interface RawADKEvent {
  author?: string;
  content?: {
    role?: string;
    parts?: Array<{
      text?: string;
      thought?: boolean;
      function_call?: { name: string; args: Record<string, unknown> };
      function_response?: { name: string; response: Record<string, unknown> };
    }>;
  };
  timestamp?: number;
}

export interface SessionDetail {
  session_id: string;
  title: string;
  state: Record<string, unknown>;
  events: RawADKEvent[];
}

// --- API Functions ---

export function listSessions(agentId?: string): Promise<SessionListItem[]> {
  const params = agentId ? `?agent_id=${agentId}` : '';
  return apiGet<SessionListItem[]>(`/sessions${params}`);
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return apiGet<SessionDetail>(`/sessions/${sessionId}`);
}

export function deleteSession(sessionId: string): Promise<void> {
  return apiDelete(`/sessions/${sessionId}`);
}
