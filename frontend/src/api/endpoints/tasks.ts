import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';
import type { ArtifactListItem } from './artifacts.ts';

// --- Types ---

export type TaskStatus =
  | 'seed'
  | 'drafting'
  | 'review'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'monitoring'
  | 'paused'
  | 'archived';

export type TaskType = 'one_shot' | 'recurring';

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

export interface TaskSchedule {
  frequency: string;
  frequency_label: string;
  auto_report: boolean;
}

export interface Task {
  task_id: string;
  user_id: string;
  org_id: string | null;
  title: string;
  seed: string;
  task_type: TaskType;
  status: TaskStatus;
  protocol: string;
  data_scope: {
    searches: SearchDef[];
    custom_fields?: Array<{ name: string; type: string; description: string }> | null;
  };
  schedule: TaskSchedule | null;
  collection_ids: string[];
  artifact_ids: string[];
  session_ids: string[];
  primary_session_id: string;
  run_count: number;
  run_history: Array<{ run_at: string; summary: string; status: string }>;
  context_summary: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  next_run_at: string | null;
}

// --- API Functions ---

export function listTasks(): Promise<Task[]> {
  return apiGet<Task[]>('/tasks');
}

export function getTask(taskId: string): Promise<Task> {
  return apiGet<Task>(`/tasks/${taskId}`);
}

export function createTask(data: {
  seed: string;
  title: string;
  task_type?: TaskType;
  protocol?: string;
  data_scope?: Record<string, unknown>;
  schedule?: TaskSchedule;
  session_id?: string;
  status?: TaskStatus;
}): Promise<Task> {
  return apiPost<Task>('/tasks', data);
}

export function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'status' | 'protocol' | 'data_scope' | 'schedule' | 'task_type' | 'context_summary'>>,
): Promise<{ ok: boolean }> {
  return apiPatch<{ ok: boolean }>(`/tasks/${taskId}`, updates);
}

export function deleteTask(taskId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/tasks/${taskId}`);
}

export function runTask(taskId: string): Promise<{ task_id: string; collection_ids: string[]; status: string }> {
  return apiPost<{ task_id: string; collection_ids: string[]; status: string }>(`/tasks/${taskId}/run`, {});
}

// --- Task Artifacts ---

export function getTaskArtifacts(taskId: string): Promise<ArtifactListItem[]> {
  return apiGet<ArtifactListItem[]>(`/tasks/${taskId}/artifacts`);
}

// --- Task Activity Logs ---

export interface TaskLogEntry {
  id: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function getTaskLogs(taskId: string, limit = 50): Promise<TaskLogEntry[]> {
  return apiGet<TaskLogEntry[]>(`/tasks/${taskId}/logs`, { limit: String(limit) });
}
