import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Info, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { planWizard } from '../../../api/endpoints/wizard.ts';
import { createAgentFromWizard } from '../../../api/endpoints/agents.ts';
import type { CustomFieldDef, WizardClarification, WizardPlan } from '../../../api/types.ts';
import type { Constitution } from '../../../api/endpoints/agents.ts';
import { DescribePanel } from './DescribePanel.tsx';
import { CollectionSettingsPanel } from './CollectionSettingsPanel.tsx';
import { AgentSettingsPanel } from './AgentSettingsPanel.tsx';
import { buildWizardRequestBody } from './wizard-utils.ts';
import { EMPTY_CONSTITUTION } from './AgentContextEditor.tsx';
import { Input } from '../../../components/ui/input.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip.tsx';

export type PlanStatus = 'idle' | 'planning' | 'ready' | 'error' | 'clarifying';

export interface WizardCollectionSettings {
  platforms: string[];
  keywords: string[];
  channelUrls: string[];
  timeRangeDays: number;
  geoScope: string;
  nPosts: number;
  existingAgentIds: string[];
  newCollectionEnabled: boolean;
  customFields: CustomFieldDef[];
  enrichmentContext: string;
  enrichmentFromAI: boolean;
  contentTypes: string[];
}

export interface WizardAgentSettings {
  taskType: 'one_shot' | 'recurring';
  scheduleIntervalHours: number;
  scheduleTime: string;
  autoReport: boolean;
  autoEmail: boolean;
  autoSlides: boolean;
  autoDashboard: boolean;
  emailRecipients: string[];
  slidesTemplateFile: File | null;
}

const DEFAULT_COLLECTION: WizardCollectionSettings = {
  platforms: ['instagram', 'tiktok'],
  keywords: [],
  channelUrls: [],
  timeRangeDays: 90,
  geoScope: 'global',
  nPosts: 500,
  existingAgentIds: [],
  newCollectionEnabled: true,
  customFields: [],
  enrichmentContext: '',
  enrichmentFromAI: false,
  contentTypes: [],
};

const DEFAULT_AGENT: WizardAgentSettings = {
  taskType: 'one_shot',
  scheduleIntervalHours: 24,
  scheduleTime: '09:00',
  autoReport: true,
  autoEmail: false,
  autoSlides: false,
  autoDashboard: false,
  emailRecipients: [],
  slidesTemplateFile: null,
};

function mapFrequencyToIntervalHours(freq: 'hourly' | 'daily' | 'weekly' | 'monthly'): number {
  if (freq === 'hourly') return 1;
  if (freq === 'weekly') return 168;
  if (freq === 'monthly') return 720;
  return 24;
}

export function AgentCreationWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [description, setDescription] = useState('');
  const [descriptionAtPlanTime, setDescriptionAtPlanTime] = useState('');

  const [planStatus, setPlanStatus] = useState<PlanStatus>('idle');
  const [planSummary, setPlanSummary] = useState('');
  const [planReasoning, setPlanReasoning] = useState('');
  const [agentTitle, setAgentTitle] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);

  const [clarifications, setClarifications] = useState<WizardClarification[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string[]>>({});

  const [collectionSettings, setCollectionSettings] =
    useState<WizardCollectionSettings>(DEFAULT_COLLECTION);
  const [taskSettings, setTaskSettings] = useState<WizardAgentSettings>(DEFAULT_AGENT);
  const [constitution, setConstitution] = useState<Constitution>({ ...EMPTY_CONSTITUTION });

  const isStale = planStatus === 'ready' && description.trim() !== descriptionAtPlanTime;

  const hasExisting = collectionSettings.existingAgentIds.length > 0;
  const hasNew =
    collectionSettings.newCollectionEnabled && collectionSettings.platforms.length > 0;
  const canSubmit =
    planStatus === 'ready' &&
    description.trim().length > 0 &&
    (hasExisting || hasNew);

  const applyPlan = (plan: WizardPlan) => {
    setAgentTitle(plan.title || 'New agent');
    setPlanSummary(plan.summary || '');
    setPlanReasoning(plan.reasoning || '');

    const nc = plan.new_collection;
    setCollectionSettings({
      platforms: nc?.platforms ?? DEFAULT_COLLECTION.platforms,
      keywords: nc?.keywords ?? [],
      channelUrls: nc?.channel_urls ?? [],
      timeRangeDays: nc?.time_range_days ?? 90,
      geoScope: nc?.geo_scope ?? 'global',
      nPosts: nc?.n_posts ?? 500,
      existingAgentIds: [],
      newCollectionEnabled: nc !== null,
      customFields: plan.custom_fields ?? [],
      enrichmentContext: plan.enrichment_context ?? '',
      enrichmentFromAI: true,
      contentTypes: plan.content_types ?? [],
    });

    setTaskSettings({
      taskType: plan.agent_type,
      scheduleIntervalHours: plan.schedule ? mapFrequencyToIntervalHours(plan.schedule.frequency) : 24,
      scheduleTime: plan.schedule?.time ?? '09:00',
      autoReport: plan.auto_report,
      autoEmail: plan.auto_email ?? false,
      autoSlides: plan.auto_slides ?? false,
      autoDashboard: plan.auto_dashboard ?? false,
      emailRecipients: [],
      slidesTemplateFile: null,
    });

    if (plan.constitution) {
      setConstitution({
        identity: plan.constitution.identity ?? '',
        mission: plan.constitution.mission ?? '',
        methodology: plan.constitution.methodology ?? '',
        scope_and_relevance: plan.constitution.scope_and_relevance ?? '',
        standards: plan.constitution.standards ?? '',
        perspective: plan.constitution.perspective ?? '',
      });
    } else if (plan.context) {
      // Backward compat: old plans may still return context
      setConstitution({
        identity: plan.context.world_context ?? '',
        mission: plan.context.mission ?? '',
        methodology: '',
        scope_and_relevance: plan.context.relevance_boundaries ?? '',
        standards: '',
        perspective: plan.context.analytical_lens ?? '',
      });
    }
  };

  const handleContinue = async () => {
    const trimmed = description.trim();
    if (trimmed.length < 10) return;

    setPlanStatus('planning');
    try {
      // Include prior answers if we're re-submitting after clarification.
      const priorAnswers = clarifications.length > 0 ? clarificationAnswers : undefined;
      const response = await planWizard(trimmed, priorAnswers);

      if (response.status === 'clarification' && response.clarifications?.length) {
        setClarifications(response.clarifications);
        setClarificationAnswers({});
        setPlanStatus('clarifying');
      } else if (response.status === 'plan' && response.plan) {
        applyPlan(response.plan);
        setClarifications([]);
        setClarificationAnswers({});
        setDescriptionAtPlanTime(trimmed);
        setPlanStatus('ready');
      }
    } catch (err) {
      console.error('wizard planner failed', err);
      toast.error('Could not generate a plan. You can still configure the agent manually.');
      setPlanStatus('error');
    }
  };

  const handleClarificationAnswer = (id: string, values: string[]) => {
    setClarificationAnswers((prev) => ({ ...prev, [id]: values }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const body = buildWizardRequestBody(description, collectionSettings, taskSettings, agentTitle, constitution);
      const result = await createAgentFromWizard(body);

      // Add new collection IDs to sources store
      const sourcesState = useSourcesStore.getState();
      for (const cid of result.collection_ids) {
        const alreadyInStore = sourcesState.sources.some((s) => s.collectionId === cid);
        if (alreadyInStore) {
          sourcesState.addToSession(cid);
          sourcesState.updateSource(cid, { taskId: result.agent_id });
        } else {
          sourcesState.setPendingLink(cid, result.agent_id);
          queryClient.invalidateQueries({ queryKey: ['collections'] });
        }
      }

      // Refresh agents list and set the new agent as active
      await useAgentStore.getState().fetchAgents();
      useAgentStore.getState().setActiveAgent(result.agent_id);

      // Navigate to the agents list page
      navigate('/agents', { replace: true });
    } catch (err) {
      toast.error('Failed to create agent. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setDescription(prompt);
  };

  return (
    <div className="space-y-6">
      {planStatus === 'ready' && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 shadow-[0_4px_20px_rgba(110,86,207,0.12)] px-5 py-4">
          <div className="flex-1 min-w-0">
            {titleEditing ? (
              <Input
                value={agentTitle}
                onChange={(e) => setAgentTitle(e.target.value)}
                onBlur={() => setTitleEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setTitleEditing(false);
                }}
                autoFocus
                className="h-8 font-heading text-base font-semibold tracking-tight"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="group flex items-center gap-1.5 text-left font-heading text-base font-semibold tracking-tight text-foreground hover:text-primary"
              >
                {agentTitle || 'New agent'}
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            {planSummary && (
              <p className="mt-1 text-[13px] text-muted-foreground line-clamp-2">{planSummary}</p>
            )}
          </div>
          {planReasoning && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Why this plan" className="text-muted-foreground hover:text-primary">
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  {planReasoning}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DescribePanel
          description={description}
          onDescriptionChange={setDescription}
          onQuickPrompt={handleQuickPrompt}
          onContinue={handleContinue}
          planStatus={planStatus}
          isStale={isStale}
          clarifications={clarifications}
          clarificationAnswers={clarificationAnswers}
          onClarificationAnswer={handleClarificationAnswer}
          onClarificationSubmit={handleContinue}
        />

        <CollectionSettingsPanel
          settings={collectionSettings}
          onChange={setCollectionSettings}
          planStatus={planStatus}
        />

        <AgentSettingsPanel
          settings={taskSettings}
          onChange={setTaskSettings}
          onSubmit={handleSubmit}
          canSubmit={canSubmit}
          isSubmitting={isSubmitting}
          planStatus={planStatus}
        />
      </div>
    </div>
  );
}
