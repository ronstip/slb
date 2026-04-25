import type { DesignResearchResult, DataExportResult, DashboardPayload, StructuredPromptResult } from '../api/types.ts';
import { TOOL_DISPLAY_NAMES } from './constants.ts';

export function getToolDisplayText(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName.replace(/_/g, ' ');
}

export function isDesignResearchResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & DesignResearchResult {
  return toolName === 'design_research' && result?.status === 'success' && !!result?.config;
}

export function isDataExportResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & DataExportResult {
  return toolName === 'export_data' && result?.status === 'success' && Array.isArray(result?.rows);
}

export function isChartResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'create_chart' && result?.status === 'success' && !!result?.chart_type;
}

export function isDashboardResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & DashboardPayload {
  return (toolName === 'generate_dashboard' || toolName === 'compose_dashboard') && result?.status === 'success' && !!result?.dashboard_id;
}

export function isStructuredPromptResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & StructuredPromptResult {
  return toolName === 'ask_user' && result?.status === 'needs_input' && Array.isArray(result?.prompts);
}

export function isStartAgentResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return (toolName === 'start_agent' || toolName === 'start_task') && result?.status === 'success' && !!(result?.agent_id || result?.task_id);
}

export function isTodoResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'update_todos' && result?.status === 'success' && !!result?.progress;
}

export function isMetricsResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'show_metrics' && result?.status === 'success' && result?.display === 'metrics';
}

export function isTopicsResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'show_topics' && result?.status === 'success' && result?.display === 'topics';
}

export function isPresentationResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'generate_presentation' && result?.status === 'success' && !!result?.presentation_id;
}