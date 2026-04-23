/**
 * Pure, store-agnostic state producer for agent tool events.
 *
 * The single source of truth for "given a tool call or tool result, what
 * changes to the message / artifacts list?" Consumed by:
 * - useSSEChat (live stream): applies patches via Zustand actions and runs
 *   live-only side effects (navigation, panel state, sources updates).
 * - session-reconstructor (persisted-event replay): applies patches by
 *   mutating a local ChatMessage.
 *
 * No store imports, no side effects, no navigation. Consumers supply clock
 * and ID-fallback strategy via MapperContext.
 */

import type { ActivityEntry, MessageCard, TodoItem } from '../stores/chat-store.ts';
import type { Artifact } from '../stores/studio-store.ts';
import type { DataExportRow } from '../api/types.ts';
import {
  getToolDisplayText,
  isChartResult,
  isDashboardResult,
  isDataExportResult,
  isDesignResearchResult,
  isMetricsResult,
  isPresentationResult,
  isStartAgentResult,
  isStructuredPromptResult,
  isTodoResult,
  isTopicsResult,
} from './event-parser.ts';

/** Tools that skip the activity log (internal plumbing). Result is still processed. */
export const INTERNAL_TOOLS: ReadonlySet<string> = new Set(['update_todos']);

export type ArtifactFallbackKind = 'chart' | 'data_export' | 'dashboard' | 'presentation';

export interface MapperContext {
  /** Timestamp stamped on all entries produced by this call. */
  now: number;
  /** Generate a fallback artifact ID when the server didn't send one. */
  fallbackId: (kind: ArtifactFallbackKind) => string;
  /** Source collection IDs to stamp on data_export artifacts. */
  dataExportSourceIds: string[];
}

export interface MessagePatch {
  /** tool_complete / tool_error / tool_blocked entry to append (null for internal tools). */
  activityEntry: ActivityEntry | null;
  /** Cards to append to the message. */
  cards: MessageCard[];
  /** Artifacts to append to the studio store. */
  artifacts: Artifact[];
  /** update_todos output: new todo list + diff entries. */
  todoUpdate?: {
    newTodos: TodoItem[];
    changes: ActivityEntry[];
  };
}

/** Short description from tool_call args, shown under the activity header. */
export function describeTool(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'execute_sql': {
      const q = (args.query ?? args.sql ?? '') as string;
      return q ? (q.length > 120 ? q.slice(0, 120) + '...' : q) : undefined;
    }
    case 'google_search':
    case 'google_search_agent':
      return (args.query as string) || undefined;
    case 'design_research':
      return (args.question as string) || (args.research_question as string) || undefined;
    case 'get_collection_details':
      return (args.collection_id as string) || undefined;
    case 'get_agent_status':
    case 'set_active_agent':
      return (args.agent_id as string) || (args.task_id as string) || undefined;
    case 'create_chart':
    case 'generate_dashboard':
    case 'compose_dashboard':
    case 'generate_presentation':
      return (args.title as string) || undefined;
    case 'export_data':
      return (args.format as string) || undefined;
    default:
      return undefined;
  }
}

/** Build a tool_start entry from a tool_call. Returns null for internal tools. */
export function mapToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: MapperContext,
): ActivityEntry | null {
  if (INTERNAL_TOOLS.has(toolName)) return null;
  return {
    kind: 'tool_start',
    toolName,
    text: getToolDisplayText(toolName),
    description: describeTool(toolName, args),
    ts: ctx.now,
  };
}

/** Diff old vs new todos, returning todo_change entries for creates and status changes. */
export function diffTodos(
  oldTodos: TodoItem[],
  newTodos: TodoItem[],
  ts: number,
): ActivityEntry[] {
  const oldMap = new Map(oldTodos.map((t) => [t.id, t]));
  const changes: ActivityEntry[] = [];
  for (const t of newTodos) {
    const old = oldMap.get(t.id);
    if (!old) {
      changes.push({ kind: 'todo_change', ts, todoId: t.id, content: t.content, fromStatus: null, toStatus: t.status });
    } else if (old.status !== t.status) {
      changes.push({ kind: 'todo_change', ts, todoId: t.id, content: t.content, fromStatus: old.status, toStatus: t.status });
    }
  }
  return changes;
}

/**
 * Map a tool_result into the state changes it implies.
 *
 * @param prevDescription  Carried from the matching tool_start entry so the
 *   completion carries it forward. Caller looks this up in the activity log.
 * @param prevTodos        Existing todos on the message — required for the
 *   update_todos diff.
 * @param durationMs       Wall-clock (live) or event-timestamp (replay) delta
 *   between tool_start and tool_result. Caller computes.
 */
export function mapToolResult(
  toolName: string,
  result: Record<string, unknown>,
  prevDescription: string | undefined,
  prevTodos: TodoItem[],
  durationMs: number,
  ctx: MapperContext,
): MessagePatch {
  const patch: MessagePatch = { activityEntry: null, cards: [], artifacts: [] };
  const text = getToolDisplayText(toolName);
  const ts = ctx.now;

  // Activity entry — skip for internal tools (their result still produces updates).
  if (!INTERNAL_TOOLS.has(toolName)) {
    if (result?.status === 'blocked' || result?.status === 'auth_required') {
      patch.activityEntry = { kind: 'tool_blocked', toolName, text, ts };
    } else if (result?.status === 'error') {
      const errorMsg = (result?.message as string) || 'Failed';
      patch.activityEntry = { kind: 'tool_error', toolName, text, error: errorMsg, durationMs, ts };
    } else {
      patch.activityEntry = { kind: 'tool_complete', toolName, text, durationMs, description: prevDescription, ts };
    }
  }

  // Blocked / auth_required / error short-circuit cards and artifacts.
  if (result?.status === 'blocked' || result?.status === 'auth_required' || result?.status === 'error') {
    return patch;
  }

  if (isDesignResearchResult(toolName, result)) {
    patch.cards.push({ type: 'research_design', data: result });
  } else if (isDataExportResult(toolName, result)) {
    const exportId = (result._artifact_id as string) || ctx.fallbackId('data_export');
    patch.cards.push({ type: 'data_export', data: { ...result, _artifactId: exportId } });
    patch.artifacts.push({
      id: exportId,
      type: 'data_export',
      title: 'Data Export',
      rows: result.rows as DataExportRow[],
      rowCount: result.row_count as number,
      columnNames: result.column_names as string[],
      sourceIds: ctx.dataExportSourceIds,
      createdAt: new Date(ts),
    });
  } else if (isChartResult(toolName, result)) {
    const chartId = (result._artifact_id as string) || ctx.fallbackId('chart');
    patch.cards.push({ type: 'chart', data: { ...result, _artifactId: chartId } });
    patch.artifacts.push({
      id: chartId,
      type: 'chart',
      title: (result.title as string) || 'Chart',
      chartType: result.chart_type as string,
      data: (result.data as Record<string, unknown>) ?? {},
      barOrientation: (result.bar_orientation as string | undefined) || undefined,
      stacked: result.stacked as boolean | undefined,
      collectionIds: (result.collection_ids as string[] | undefined) ?? undefined,
      sourceSql: (result.source_sql as string | undefined) || undefined,
      createdAt: new Date(ts),
    });
  } else if (isDashboardResult(toolName, result)) {
    const dashboardId = (result._artifact_id as string) || (result.dashboard_id as string) || ctx.fallbackId('dashboard');
    patch.cards.push({ type: 'dashboard', data: result });
    patch.artifacts.push({
      id: dashboardId,
      type: 'dashboard',
      title: result.title as string,
      collectionIds: result.collection_ids as string[],
      collectionNames: result.collection_names as Record<string, string>,
      createdAt: new Date(ts),
    });
  } else if (isStartAgentResult(toolName, result)) {
    // No card or artifact — start_agent is an action. Sources/navigation are
    // live-only side effects handled by useSSEChat; on replay they're already
    // baked into the fetched session state.
  } else if (isStructuredPromptResult(toolName, result)) {
    patch.cards.push({ type: 'structured_prompt', data: result });
  } else if (isTodoResult(toolName, result)) {
    const newTodos = (result.todos as TodoItem[]) ?? [];
    const changes = diffTodos(prevTodos, newTodos, ts);
    patch.todoUpdate = { newTodos, changes };
  } else if (isMetricsResult(toolName, result)) {
    patch.cards.push({ type: 'metrics_section', data: result });
  } else if (isTopicsResult(toolName, result)) {
    patch.cards.push({ type: 'topics_section', data: result });
  } else if (isPresentationResult(toolName, result)) {
    const presentationId = (result._artifact_id as string) || (result.presentation_id as string) || ctx.fallbackId('presentation');
    patch.artifacts.push({
      id: presentationId,
      type: 'presentation',
      title: (result.title as string) || 'Presentation',
      collectionIds: (result.collection_ids as string[]) || [],
      slideCount: (result.slide_count as number) || 0,
      createdAt: new Date(ts),
    });
  }

  return patch;
}
