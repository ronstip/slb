import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';

export interface ExplorerLayoutListItem {
  layout_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export function listExplorerLayouts(agentId: string): Promise<ExplorerLayoutListItem[]> {
  return apiGet<ExplorerLayoutListItem[]>(`/explorer/layouts?agent_id=${agentId}`);
}

export function createExplorerLayout(body: {
  agent_id: string;
  title: string;
}): Promise<ExplorerLayoutListItem> {
  return apiPost<ExplorerLayoutListItem>('/explorer/layouts', body);
}

export function updateExplorerLayout(
  layoutId: string,
  body: { title?: string },
): Promise<ExplorerLayoutListItem> {
  return apiPatch<ExplorerLayoutListItem>(`/explorer/layouts/${layoutId}`, body);
}

export function deleteExplorerLayout(layoutId: string): Promise<void> {
  return apiDelete(`/explorer/layouts/${layoutId}`);
}
