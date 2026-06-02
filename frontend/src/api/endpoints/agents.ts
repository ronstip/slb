import { apiGet, apiPost, apiPatch } from '../client.ts';
import type { ArtifactListItem } from './artifacts.ts';
import type { CustomFieldDef } from '../types.ts';

// --- Types ---

export type AgentStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'archived';

export type AgentType = 'one_shot' | 'recurring';

/** A single data source - one platform, with its own keywords, post quota,
 *  time range, and region. Each source maps 1:1 to a collection at run time. */
export interface Source {
  platform: string;
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
  executive_briefing?: string;
  state_of_the_world: string;
  open_threads: string;
  process_notes: string;
  generated_at: string;
  word_count: number;
}

export type AgentOutputType =
  | 'briefing'
  | 'slides'
  | 'email'
  | 'data_export'
  | 'post_examples';

export interface AgentOutputConfig {
  // briefing
  template?: 'exec' | 'analyst' | 'custom';
  // slides
  audience?: string;
  template_file_id?: string;
  // email
  recipients?: string[];
  format?: 'briefing' | 'summary';
  // data_export
  export_format?: 'csv' | 'json';
  columns?: string[];
  // post_examples
  count?: number;
  criteria?: string;
}

export interface AgentOutput {
  id: string;
  type: AgentOutputType;
  config: AgentOutputConfig;
}

export type AgentVisibility = 'private' | 'org';

export interface Agent {
  agent_id: string;
  user_id: string;
  org_id: string | null;
  /** Org-sharing for this agent. 'private' (default) = only the owner sees it;
   *  'org' = shared with every member of the owner's organization. */
  visibility?: AgentVisibility;
  /** Server-computed for the requesting user: false when this agent is owned by
   *  another member of your org and shared with you. */
  is_owner?: boolean;
  /** Display name (or email) of the owner - set only on agents shared with you
   *  by someone else, so the UI can show "Shared by …". */
  owner_label?: string | null;
  title: string;
  agent_type: AgentType;
  status: AgentStatus | null;
  data_scope: {
    sources: Source[];
    /** @deprecated Use `outputs` instead. Kept for legacy agents created before
     * the typed outputs migration. */
    auto_report?: boolean;
    /** @deprecated Use `outputs` instead. */
    auto_email?: boolean;
    /** @deprecated Use `outputs` instead. */
    auto_slides?: boolean;
    /** @deprecated Use the corresponding email output's `config.recipients`. */
    email_recipients?: string[];
  };
  enrichment_config?: {
    custom_fields?: CustomFieldDef[] | null;
    enrichment_context?: string;
    content_types?: string[] | null;
  };
  outputs?: AgentOutput[];
  context?: AgentContext;
  constitution?: Constitution;
  paused?: boolean;
  schedule: AgentSchedule | null;
  todos: TodoItem[];
  collection_ids: string[];
  artifact_ids: string[];
  /** Agent-level data window. ISO date strings (YYYY-MM-DD). Start is set
   *  at creation from `today − MAX(source.time_range_days)`; end is null
   *  by default (no upper bound). Both editable in Settings → Sources. */
  data_start_date?: string | null;
  data_end_date?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  next_run_at: string | null;
  version?: number;
  session_ids?: string[];
  active_run_id?: string | null;
  context_summary?: string;
  continuation_ready?: boolean;
  continuation_ready_at?: string | null;
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
  enrichment_config?: Record<string, unknown>;
  schedule?: AgentSchedule;
  status?: AgentStatus;
}): Promise<Agent> {
  return apiPost<Agent>('/agents', data);
}

export function updateAgent(
  agentId: string,
  updates: Partial<Pick<Agent, 'title' | 'status' | 'data_scope' | 'enrichment_config' | 'schedule' | 'agent_type' | 'paused' | 'todos' | 'constitution' | 'outputs' | 'data_start_date' | 'data_end_date'>>,
): Promise<{ ok: boolean; version?: number }> {
  return apiPatch<{ ok: boolean; version?: number }>(`/agents/${agentId}`, updates);
}

/** Share an agent with the org or make it private again. Owner-only on the
 *  server; propagates to the agent's collections so shared members can read its
 *  feed/data. */
export function setAgentVisibility(
  agentId: string,
  visibility: AgentVisibility,
): Promise<{ ok: boolean; visibility: AgentVisibility }> {
  return apiPatch<{ ok: boolean; visibility: AgentVisibility }>(
    `/agents/${agentId}/visibility`,
    { visibility },
  );
}

export function runAgent(agentId: string): Promise<{ agent_id: string; run_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ agent_id: string; run_id: string; collection_ids: string[]; status: string }>(`/agents/${agentId}/run`, {});
}

/** Re-collect data for selected sources. Targeting: pass `source_idx` for one
 *  card, `platform` to refresh every card on that platform, or omit both to
 *  refresh everything. Does NOT trigger the agent workflow - collection
 *  pipelines only. */
export function runAgentSources(
  agentId: string,
  target?: { source_idx: number } | { platform: string },
): Promise<{ agent_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ agent_id: string; collection_ids: string[]; status: string }>(
    `/agents/${agentId}/sources/run`,
    target ?? {},
  );
}

/** Fetch one or more specific posts by URL through the unified pipeline.
 *  Server parses each URL, groups by platform, and dispatches one collection
 *  per platform - same enrichment/embedding path as keyword-collected posts.
 *  Only X/Twitter URLs are supported today; others return 400. */
export function fetchPostsByUrl(
  agentId: string,
  urls: string[],
  note?: string,
  includeComments?: boolean,
): Promise<{ agent_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ agent_id: string; collection_ids: string[]; status: string }>(
    `/agents/${agentId}/fetch-posts`,
    { urls, note, include_comments: includeComments ?? false },
  );
}

export function resumeAgent(agentId: string): Promise<{ ok: boolean; agent_id: string; status: string }> {
  return apiPost<{ ok: boolean; agent_id: string; status: string }>(`/agents/${agentId}/resume`, {});
}

export interface CreateFromWizardPayload {
  title: string;
  description?: string;
  agent_type: 'one_shot' | 'recurring';
  sources: Source[];
  schedule?: { frequency: string; frequency_label: string } | null;
  custom_fields?: Array<{ name: string; type: string; description: string; options?: string[] }> | null;
  enrichment_context?: string;
  content_types?: string[];
  context?: AgentContext;
  constitution?: Constitution;
  existing_agent_ids?: string[];
  /** Typed outputs - preferred. When set, supersedes the auto_* booleans. */
  outputs?: AgentOutput[];
  /** @deprecated send `outputs` instead. */
  auto_report?: boolean;
  /** @deprecated send `outputs` instead. */
  auto_email?: boolean;
  /** @deprecated send `outputs` instead. */
  email_recipients?: string[];
  /** @deprecated send `outputs` instead. */
  auto_slides?: boolean;
  start_run?: boolean;
}

export function createAgentFromWizard(
  data: CreateFromWizardPayload,
): Promise<{ agent_id: string; run_id: string | null; collection_ids: string[]; status: string | null }> {
  return apiPost<{ agent_id: string; run_id: string | null; collection_ids: string[]; status: string | null }>('/agents/create-from-wizard', data);
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
