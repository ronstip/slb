import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';
import type { SocialDashboardWidget } from '../../features/studio/dashboard/types-social-dashboard.ts';

/** A Watch — agentic alerting (supersedes Alert). User-owned monitor over a
 *  Subject's scope_posts. See docs/alerts/watch-system-spec.md. */

export type SubjectMode = 'agents' | 'all_my_agents' | 'all_org_agents';
export type Grain = 'per_agent' | 'aggregate';

export interface Subject {
  mode: SubjectMode;
  agent_ids?: string[];
  grain?: Grain;
}

export type Reducer = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p90' | 'distinct';
export type Basis = 'absolute' | 'share' | 'change';
export type CompareOp = '>' | '>=' | '<' | '<=' | 'between';

export interface StructuredCondition {
  scope?: Record<string, unknown> | null;
  measure: { reducer: Reducer; field?: string | null };
  basis: Basis;
  share?: { denominator?: Record<string, unknown> | null } | null;
  change?: { vs: 'prior_window' } | null;
  group_by?: string | null;
  compare: { op: CompareOp; threshold: number; threshold2?: number | null };
}

export interface SemanticCondition {
  instruction: string;
  scope?: Record<string, unknown> | null;
}

export interface Trigger {
  kind: 'structured' | 'semantic';
  structured?: StructuredCondition | null;
  semantic?: SemanticCondition | null;
}

export interface Window {
  mode: 'cumulative' | 'rolling' | 'vs_prior';
  hours: number;
}

export type Channel = 'in_app' | 'email' | 'whatsapp';

export interface Action {
  tier: 'notify' | 'briefing';
  channels: Channel[];
  include_widgets?: boolean;
  recipients?: string[];
  /** Dashboard widgets rendered to PNGs in the email when include_widgets is on. */
  widgets?: SocialDashboardWidget[];
}

export interface WatchSource {
  kind: 'nl' | 'manual';
  nl_text?: string | null;
}

export interface Watch {
  watch_id: string;
  owner_uid: string;
  name: string;
  subject: Subject;
  trigger: Trigger;
  window: Window;
  eval_on: 'schedule' | 'run';
  eval_interval_sec?: number;
  action: Action;
  source: WatchSource;
  enabled: boolean;
  min_interval_sec?: number;
  created_at: string | null;
  updated_at: string | null;
  last_fired_at: string | null;
  trigger_count: number;
}

export interface WatchCreateBody {
  name: string;
  subject: Subject;
  trigger: Trigger;
  window?: Window;
  eval_on?: 'schedule' | 'run';
  eval_interval_sec?: number;
  action?: Action;
  source?: WatchSource;
  enabled?: boolean;
  min_interval_sec?: number;
}

export type WatchUpdateBody = Partial<{
  name: string;
  subject: Subject;
  trigger: Trigger;
  window: Window;
  eval_on: 'schedule' | 'run';
  eval_interval_sec: number;
  action: Action;
  enabled: boolean;
  min_interval_sec: number;
}>;

/** /watches/compile response: a reviewable draft or clarifying questions. */
export interface WatchCompileResult {
  status: 'watch' | 'clarification';
  draft?: WatchCreateBody;
  rationale?: string;
  clarifications?: string[];
}

export interface WatchPreviewResult {
  supported: boolean;
  reason?: string;
  would_fire?: boolean;
  value?: number | null;
  measure_label?: string;
  groups?: { key: string; value: number | null; fired: boolean }[];
  sample_post_ids?: string[];
  rows_scanned?: number;
}

export function listWatches(): Promise<{ watches: Watch[] }> {
  return apiGet('/watches');
}

export function createWatch(body: WatchCreateBody): Promise<Watch> {
  return apiPost('/watches', body);
}

export function compileWatch(nl_text: string, subject: Subject): Promise<WatchCompileResult> {
  return apiPost('/watches/compile', { nl_text, subject });
}

export function previewWatch(body: WatchCreateBody): Promise<WatchPreviewResult> {
  return apiPost('/watches/preview', body);
}

export function updateWatch(watchId: string, body: WatchUpdateBody): Promise<Watch> {
  return apiPatch(`/watches/${watchId}`, body);
}

export function deleteWatch(watchId: string): Promise<void> {
  return apiDelete(`/watches/${watchId}`);
}

/** A watch "covers" this agent if its subject names the agent or spans all agents. */
export function watchCoversAgent(w: Watch, agentId: string): boolean {
  if (w.subject.mode !== 'agents') return true;
  return (w.subject.agent_ids ?? []).includes(agentId);
}

export function summarizeTrigger(w: Watch): string {
  const t = w.trigger;
  if (t.kind === 'semantic') {
    return `AI watch: "${t.semantic?.instruction ?? ''}"`;
  }
  const s = t.structured;
  if (!s) return '—';
  const m = s.measure.reducer === 'count' ? 'count' : `${s.measure.reducer}(${s.measure.field})`;
  const core = s.basis === 'absolute' ? m : `${s.basis} of ${m}`;
  const gb = s.group_by ? ` per ${s.group_by}` : '';
  const thr = s.basis === 'share' ? `${Math.round(s.compare.threshold * 100)}%` : s.compare.threshold;
  return `${core}${gb} ${s.compare.op} ${thr}`;
}
