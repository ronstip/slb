import type { DesignResearchResult, InsightResult, DataExportResult } from '../api/types.ts';
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

export function isInsightResult(
  toolName: string,
  result?: Record<string, unknown>,
): result is Record<string, unknown> & InsightResult {
  return toolName === 'get_insights' && result?.status === 'success' && !!result?.narrative;
}

export function isProgressResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'get_progress' && result?.status === 'success';
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

export function isPostEmbedResult(
  toolName: string,
  result?: Record<string, unknown>,
): boolean {
  return toolName === 'display_posts' && result?.status === 'success' && Array.isArray(result?.posts);
}
