import type { DesignResearchResult, InsightResult, DataExportResult } from '../api/types.ts';
import { TOOL_DISPLAY_NAMES } from './constants.ts';

export function getToolDisplayText(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || `Running ${toolName}...`;
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
