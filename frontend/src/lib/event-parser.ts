import type { DesignResearchResult, DataExportResult, InsightReportPayload, DashboardPayload, StructuredPromptResult } from '../api/types.ts';
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

export function isReportResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & InsightReportPayload {
  return toolName === 'generate_report' && result?.status === 'success' && Array.isArray(result?.cards);
}

export function isDashboardResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & DashboardPayload {
  return toolName === 'generate_dashboard' && result?.status === 'success' && !!result?.dashboard_id;
}

export function isUpdateDashboardResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'update_dashboard' && result?.status === 'success' && !!result?.artifact_id;
}

export function isGetDashboardLayoutResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'get_dashboard_layout' && result?.status === 'success';
}

export function isStructuredPromptResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & StructuredPromptResult {
  return toolName === 'ask_user' && result?.status === 'needs_input' && Array.isArray(result?.prompts);
}