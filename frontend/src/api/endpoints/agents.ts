import { apiGet, apiPost, apiPatch } from '../client.ts';
import type { ArtifactListItem } from './artifacts.ts';

// --- Types ---

export type AgentStatus =
  | 'running'
  | 'success'
  | 'failed'
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
  phase?: string;
  automated?: boolean;
  custom?: boolean;
}

/** @deprecated Use Constitution instead. */
export interface AgentContext {
  mission: string;
  world_context: string;
  relevance_boundaries: string;
  analytical_lens: string;
}

export interface Constitution {
  identity: string;
  mission: string;
  methodology: string;
  scope_and_relevance: string;
  standards: string;
  perspective: string;
}

export interface Briefing {
  state_of_the_world: string;
  open_threads: string;
  process_notes: string;
  generated_at: string;
  word_count: number;
}

export interface Agent {
  agent_id: string;
  user_id: string;
  org_id: string | null;
  title: string;
  agent_type: AgentType;
  status: AgentStatus;
  data_scope: {
    searches: SearchDef[];
    custom_fields?: Array<{ name: string; type: string; description: string }> | null;
    enrichment_context?: string;
  };
  context?: AgentContext;
  constitution?: Constitution;
  paused?: boolean;
  schedule: AgentSchedule | null;
  todos: TodoItem[];
  collection_ids: string[];
  artifact_ids: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  next_run_at: string | null;
  version?: number;
  session_ids?: string[];
  active_run_id?: string | null;
  context_summary?: string;
}

// --- Run Types ---

export interface AgentRun {
  run_id: string;
  status: 'running' | 'success' | 'failed';
  trigger: 'wizard' | 'manual' | 'scheduled';
  agent_version?: number;
  started_at: string;
  completed_at: string | null;
  collection_ids: string[];
  artifact_ids: string[];
  briefing?: Briefing | null;
}

// --- API Functions ---

export function listAgents(): Promise<Agent[]> {
  return apiGet<Agent[]>('/agents');
}

export function getAgent(agentId: string): Promise<Agent> {
  return apiGet<Agent>(`/agents/${agentId}`);
}

export function createAgent(data: {
  title: string;
  agent_type?: AgentType;
  data_scope?: Record<string, unknown>;
  schedule?: AgentSchedule;
  status?: AgentStatus;
}): Promise<Agent> {
  return apiPost<Agent>('/agents', data);
}

export function updateAgent(
  agentId: string,
  updates: Partial<Pick<Agent, 'title' | 'status' | 'data_scope' | 'schedule' | 'agent_type' | 'paused' | 'todos' | 'constitution'>>,
): Promise<{ ok: boolean; version?: number }> {
  return apiPatch<{ ok: boolean; version?: number }>(`/agents/${agentId}`, updates);
}

export function runAgent(agentId: string): Promise<{ agent_id: string; run_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ agent_id: string; run_id: string; collection_ids: string[]; status: string }>(`/agents/${agentId}/run`, {});
}

export interface CreateFromWizardPayload {
  title: string;
  description?: string;
  agent_type: 'one_shot' | 'recurring';
  searches: Array<{
    platforms: string[];
    keywords: string[];
    channels?: string[];
    time_range_days: number;
    geo_scope: string;
    n_posts: number;
  }>;
  schedule?: { frequency: string; frequency_label: string } | null;
  custom_fields?: Array<{ name: string; type: string; description: string; options?: string[] }> | null;
  enrichment_context?: string;
  context?: AgentContext;
  constitution?: Constitution;
  existing_agent_ids?: string[];
  auto_report?: boolean;
  auto_email?: boolean;
  email_recipients?: string[];
  auto_slides?: boolean;
  auto_dashboard?: boolean;
}

export function createAgentFromWizard(
  data: CreateFromWizardPayload,
): Promise<{ agent_id: string; run_id: string | null; collection_ids: string[]; status: string }> {
  return apiPost<{ agent_id: string; run_id: string | null; collection_ids: string[]; status: string }>('/agents/create-from-wizard', data);
}

// --- Agent Runs ---

export function listAgentRuns(agentId: string, limit = 20): Promise<AgentRun[]> {
  return apiGet<AgentRun[]>(`/agents/${agentId}/runs`, { limit: String(limit) });
}

export function getAgentRun(agentId: string, runId: string): Promise<AgentRun> {
  return apiGet<AgentRun>(`/agents/${agentId}/runs/${runId}`);
}

// --- Agent Context ---

export function refreshAgentContext(agentId: string): Promise<{ status: string; world_context: string }> {
  return apiPost<{ status: string; world_context: string }>(`/agents/${agentId}/refresh-context`, {});
}

// --- Agent Artifacts ---

export function getAgentArtifacts(agentId: string): Promise<ArtifactListItem[]> {
  return apiGet<ArtifactListItem[]>(`/agents/${agentId}/artifacts`);
}

// --- Agent Activity Logs ---

/** Structured entry_type values emitted by autonomous agent execution. */
export type AgentLogEntryType =
  | 'tool_start'
  | 'tool_complete'
  | 'tool_error'
  | 'thinking'
  | 'text'
  | 'todo_update';

export interface AgentLogEntry {
  id: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  timestamp: string;
  metadata?: {
    entry_type?: AgentLogEntryType;
    tool_name?: string;
    description?: string;
    duration_ms?: number;
    error?: string;
    full_text?: string;
    todos?: Array<{ id: string; content: string; status: string }>;
    [key: string]: unknown;
  };
}

export function getAgentLogs(agentId: string, limit = 50): Promise<AgentLogEntry[]> {
  return apiGet<AgentLogEntry[]>(`/agents/${agentId}/logs`, { limit: String(limit) });
}
