import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';
import type { ArtifactListItem } from './artifacts.ts';

// --- Types ---

export type AgentStatus =
  | 'approved'
  | 'executing'
  | 'awaiting_analysis'
  | 'analyzing'
  | 'completed'
  | 'monitoring'
  | 'paused'
  | 'archived';

export type AgentType = 'one_shot' | 'recurring';

export interface SearchDef {
  platforms: string[];
  keywords: string[];
  channels?: string[];
  time_range_days: number;
  start_date?: string | null;
  end_date?: string | null;
  geo_scope: string;
  n_posts: number;
}

export interface AgentSchedule {
  frequency: string;
  frequency_label: string;
  auto_report: boolean;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Agent {
  task_id: string;
  user_id: string;
  org_id: string | null;
  title: string;
  task_type: AgentType;
  status: AgentStatus;
  data_scope: {
    searches: SearchDef[];
    custom_fields?: Array<{ name: string; type: string; description: string }> | null;
  };
  schedule: AgentSchedule | null;
  todos: TodoItem[];
  collection_ids: string[];
  artifact_ids: string[];
  session_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  next_run_at: string | null;
  // Legacy fields (may exist on old records)
  seed?: string;
  protocol?: string;
  session_ids?: string[];
  primary_session_id?: string;
  run_count?: number;
  run_history?: Array<{ run_at: string; summary: string; status: string }>;
  context_summary?: string;
}

// --- API Functions ---
// Note: API URLs remain /tasks/* to match the backend wire format.

export function listAgents(): Promise<Agent[]> {
  return apiGet<Agent[]>('/tasks');
}

export function getAgent(agentId: string): Promise<Agent> {
  return apiGet<Agent>(`/tasks/${agentId}`);
}

export function createAgent(data: {
  title: string;
  task_type?: AgentType;
  data_scope?: Record<string, unknown>;
  schedule?: AgentSchedule;
  session_id?: string;
  status?: AgentStatus;
}): Promise<Agent> {
  return apiPost<Agent>('/tasks', data);
}

export function updateAgent(
  agentId: string,
  updates: Partial<Pick<Agent, 'title' | 'status' | 'data_scope' | 'schedule' | 'task_type'>>,
): Promise<{ ok: boolean }> {
  return apiPatch<{ ok: boolean }>(`/tasks/${agentId}`, updates);
}

export function deleteAgent(agentId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/tasks/${agentId}`);
}

export function runAgent(agentId: string): Promise<{ task_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ task_id: string; collection_ids: string[]; status: string }>(`/tasks/${agentId}/run`, {});
}

// --- Agent Artifacts ---

export function getAgentArtifacts(agentId: string): Promise<ArtifactListItem[]> {
  return apiGet<ArtifactListItem[]>(`/tasks/${agentId}/artifacts`);
}

// --- Agent Activity Logs ---

export interface AgentLogEntry {
  id: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function getAgentLogs(agentId: string, limit = 50): Promise<AgentLogEntry[]> {
  return apiGet<AgentLogEntry[]>(`/tasks/${agentId}/logs`, { limit: String(limit) });
}
