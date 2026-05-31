import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Info,
  Loader2,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { notifyError } from '../../../lib/notify.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { planWizard } from '../../../api/endpoints/wizard.ts';
import { createAgentFromWizard } from '../../../api/endpoints/agents.ts';
import type { CustomFieldDef, WizardClarification, WizardPlan } from '../../../api/types.ts';
import type { AgentOutput, Constitution } from '../../../api/endpoints/agents.ts';
import { DescribePanel } from './DescribePanel.tsx';
import { CollectionSettingsPanel } from './CollectionSettingsPanel.tsx';
import { AgentSettingsPanel } from './AgentSettingsPanel.tsx';
import { buildWizardRequestBody } from './wizard-utils.ts';
import { EMPTY_CONSTITUTION } from './AgentContextEditor.tsx';
import { BotAvatar } from '../../../components/BrandElements.tsx';
import { BRAND_NAME } from '../../../components/Logo.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip.tsx';
import { cn } from '../../../lib/utils.ts';

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
  /** Run times of day, UTC (HH:MM). The first entry is sent to the backend
   *  schedule string today; additional entries are described to the agent
   *  prompt so the planner knows about them. */
  scheduleTimes: string[];
  /** Day-of-week (0=Sun..6=Sat) for weekly cadence, or day-of-month (1..31)
   *  for monthly. Ignored for hourly/daily. Surfaced to the planner via the
   *  agent prompt — the schedule string itself stays cadence-only. */
  scheduleDay: number;
  outputs: AgentOutput[];
  outputsFromAI: boolean;
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
  scheduleTimes: ['09:00'],
  scheduleDay: 1, // Monday for weekly; 1st of month for monthly
  outputs: [{ id: 'briefing', type: 'briefing', config: { template: 'exec' } }],
  outputsFromAI: false,
};

function mapFrequencyToIntervalHours(freq: 'hourly' | 'daily' | 'weekly' | 'monthly'): number {
  if (freq === 'hourly') return 1;
  if (freq === 'weekly') return 168;
  if (freq === 'monthly') return 720;
  return 24;
}

type StepIndex = 0 | 1 | 2;

const STEP_META: { key: StepIndex; label: string; subtitle: string }[] = [
  { key: 0, label: 'Describe',            subtitle: 'What to listen for' },
  { key: 1, label: 'Sources & data',      subtitle: 'Where to look, how deep' },
  { key: 2, label: 'Schedule & delivery', subtitle: 'When and how to deliver' },
];

export function AgentCreationWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepIndex>(0);

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

    // Outputs come from the planner directly; fall back to deriving them from
    // the legacy auto_* booleans for older planner responses.
    let resolvedOutputs: AgentOutput[] = plan.outputs ?? [];
    if (resolvedOutputs.length === 0) {
      if (plan.auto_report) resolvedOutputs.push({ id: 'briefing', type: 'briefing', config: { template: 'exec' } });
      if (plan.auto_slides) resolvedOutputs.push({ id: 'slides', type: 'slides', config: {} });
      if (plan.auto_email) resolvedOutputs.push({ id: 'email', type: 'email', config: { recipients: [], format: 'briefing' } });
    }

    setTaskSettings({
      taskType: plan.agent_type,
      scheduleIntervalHours: plan.schedule ? mapFrequencyToIntervalHours(plan.schedule.frequency) : 24,
      scheduleTimes: [plan.schedule?.time ?? '09:00'],
      scheduleDay: 1,
      outputs: resolvedOutputs,
      outputsFromAI: true,
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
      // Credit/trial 402s now surface here (the planner is a gated paid call) —
      // notifyError yields the Buy-credit toast; other failures fall back to
      // the manual-config hint.
      notifyError(err, 'Could not generate a plan. You can still configure the agent manually.');
      setPlanStatus('error');
    }
  };

  const handleClarificationAnswer = (id: string, values: string[]) => {
    setClarificationAnswers((prev) => ({ ...prev, [id]: values }));
  };

  const handleSubmit = async (startRun: boolean = true) => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const body = buildWizardRequestBody(description, collectionSettings, taskSettings, agentTitle, constitution, startRun);
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

      // Navigate to the new agent's Overview page so users see live progress.
      navigate(`/agents/${result.agent_id}`, { replace: true });
    } catch (err) {
      notifyError(err, 'Failed to create agent. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setDescription(prompt);
  };

  // Auto-advance from Describe → Sources & data the moment a plan becomes ready,
  // so the user is dropped straight onto the freshly populated step 2.
  useEffect(() => {
    if (planStatus === 'ready' && currentStep === 0) {
      setCurrentStep(1);
    }
    // We deliberately omit currentStep — we only want to push forward on the
    // ready transition, not whenever the user navigates back to step 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStatus]);

  // ── Stepper navigation ──
  const isPlanReady = planStatus === 'ready' || planStatus === 'error';
  const isPlanning = planStatus === 'planning';
  const isClarifying = planStatus === 'clarifying';

  // Which steps are reachable.
  const stepEnabled = (idx: StepIndex): boolean => {
    if (idx === 0) return true;
    return isPlanReady;
  };

  const handleStepClick = (idx: StepIndex) => {
    if (!stepEnabled(idx)) return;
    setCurrentStep(idx);
  };

  const handleBack = () => {
    if (currentStep === 0) return;
    setCurrentStep((s) => Math.max(0, s - 1) as StepIndex);
  };

  const handleNext = () => {
    if (currentStep === 0) {
      // On step 1 the user is asking the AI to plan. After it returns "ready"
      // the useEffect above will auto-advance to step 2. If a plan is already
      // ready and the description hasn't changed, just navigate forward.
      if (isPlanReady && !isStale) {
        setCurrentStep(1);
      } else {
        handleContinue();
      }
      return;
    }
    if (currentStep === 1) {
      setCurrentStep(2);
      return;
    }
    // currentStep === 2 → submit
    handleSubmit(true);
  };

  // ── Footer button label / disabled state ──
  let nextLabel = 'Continue';
  let nextDisabled = false;
  let nextIcon: React.ReactNode = <ArrowRight className="h-4 w-4" />;

  if (currentStep === 0) {
    if (isPlanning) { nextLabel = 'Planning…'; nextDisabled = true; nextIcon = <Loader2 className="h-4 w-4 animate-spin" />; }
    else if (isClarifying) { nextLabel = 'Answer the questions to continue'; nextDisabled = true; }
    else if (isPlanReady && !isStale) { nextLabel = 'Continue'; nextDisabled = description.trim().length < 10; }
    else if (isPlanReady && isStale) { nextLabel = 'Re-plan agent'; nextDisabled = description.trim().length < 10; nextIcon = <Sparkles className="h-4 w-4" />; }
    else { nextLabel = 'Plan agent'; nextDisabled = description.trim().length < 10; nextIcon = <Sparkles className="h-4 w-4" />; }
  } else if (currentStep === 1) {
    nextLabel = 'Continue';
  } else {
    if (isSubmitting) { nextLabel = 'Creating agent…'; nextDisabled = true; nextIcon = <Loader2 className="h-4 w-4 animate-spin" />; }
    else { nextLabel = 'Create agent'; nextDisabled = !canSubmit; nextIcon = <Sparkles className="h-4 w-4" />; }
  }

  // Footer eyebrow stat — varies per step to nudge the user about what's
  // about to happen next. Mirrors the design copy.
  const estMinutes = Math.max(1, Math.round(collectionSettings.nPosts / 500));
  let footerStat: string | null = null;
  if (currentStep === 0) {
    footerStat = `${BRAND_NAME} will draft a plan you can review`;
  } else if (currentStep === 1 && isPlanReady) {
    footerStat = `First run · ~${estMinutes} min · ~${collectionSettings.nPosts.toLocaleString()} posts`;
  } else if (currentStep === 2 && isPlanReady) {
    footerStat = canSubmit ? 'Ready · click Create to launch' : 'Configure outputs to continue';
  }

  return (
    <div>
      {/* ── Single unified wizard card: stepper tabs at top, then the
           plan-identity header (after plan ready), then the step body and
           footer all share the same outer card and border. ── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Stepper tabs — divided into 3 columns with vertical separators. */}
        <StepperTabs
          currentStep={currentStep}
          onStepClick={handleStepClick}
          stepEnabled={stepEnabled}
        />

        {/* Header bar — agent identity (after plan ready, shown on steps 2 & 3) */}
        {isPlanReady && currentStep > 0 && (
          <div className="flex items-start gap-3 border-b border-border bg-[color:var(--color-accent-vibrant)]/5 px-5 py-4">
            <BotAvatar seed={agentTitle || 'new-agent'} size={44} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Created by {BRAND_NAME}
              </div>
              {titleEditing ? (
                <Input
                  value={agentTitle}
                  onChange={(e) => setAgentTitle(e.target.value)}
                  onBlur={() => setTitleEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setTitleEditing(false);
                  }}
                  autoFocus
                  className="mt-1 h-9 font-serif text-2xl tracking-tight"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setTitleEditing(true)}
                  className="group mt-0.5 flex items-center gap-1.5 text-left font-serif text-2xl leading-tight tracking-tight text-foreground hover:text-primary"
                >
                  {agentTitle || 'New agent'}
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              {planSummary && (
                <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{planSummary}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {planReasoning && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="Why this plan" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-primary">
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs text-xs">
                      {planReasoning}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <button
                type="button"
                onClick={() => setCurrentStep(0)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Pencil className="h-3 w-3" />
                Edit prompt
              </button>
            </div>
          </div>
        )}

        {/* Step body */}
        <div className="p-6">
          {currentStep === 0 && (
            <DescribePanel
              embedded
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
          )}

          {currentStep === 1 && (
            <CollectionSettingsPanel
              embedded
              settings={collectionSettings}
              onChange={setCollectionSettings}
              planStatus={planStatus}
            />
          )}

          {currentStep === 2 && (
            <AgentSettingsPanel
              embedded
              settings={taskSettings}
              onChange={setTaskSettings}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              planStatus={planStatus}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/20 px-5 py-3">
          <div className="flex items-center gap-2 order-1">
            {currentStep > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="gap-1.5"
                disabled={isSubmitting}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleNext}
              disabled={nextDisabled}
              className="gap-1.5"
            >
              {nextIcon}
              {nextLabel}
            </Button>
            {currentStep === 2 && !isSubmitting && canSubmit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting}
              >
                Create without running
              </Button>
            )}
          </div>
          <div className="order-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {footerStat ?? (currentStep === 0 ? 'Step 1 of 3' : currentStep === 1 ? 'Step 2 of 3' : 'Step 3 of 3')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step tabs (top of wizard) ──────────────────────────────────────────────
//
// Three columns in a single row, divided by faint vertical separators. The
// active column gets a brighter background and a primary underline along
// its bottom edge — mirrors the Claude design exactly.
function StepperTabs({
  currentStep,
  onStepClick,
  stepEnabled,
}: {
  currentStep: StepIndex;
  onStepClick: (idx: StepIndex) => void;
  stepEnabled: (idx: StepIndex) => boolean;
}) {
  return (
    <div className="grid grid-cols-1 border-b border-border sm:grid-cols-3">
      {STEP_META.map((s, i) => {
        const isActive = currentStep === s.key;
        const isComplete = currentStep > s.key;
        const enabled = stepEnabled(s.key);
        const hasRightDivider = i < STEP_META.length - 1;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onStepClick(s.key)}
            disabled={!enabled}
            className={cn(
              'group relative flex items-center gap-3 px-5 py-3.5 text-left transition-colors',
              hasRightDivider && 'sm:border-r sm:border-border',
              isActive
                ? 'bg-card'
                : enabled
                  ? 'bg-muted/40 hover:bg-muted/60'
                  : 'bg-muted/30 cursor-not-allowed',
            )}
          >
            {/* Active underline (sits on the bottom edge of the active column) */}
            {isActive && (
              <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-primary" />
            )}
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isComplete
                    ? 'bg-primary/15 text-primary'
                    : 'border border-border bg-card text-muted-foreground',
              )}
            >
              {isComplete ? <Check className="h-3 w-3" /> : s.key + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'truncate text-[13px] font-semibold tracking-tight',
                  isActive ? 'text-foreground' : enabled ? 'text-foreground/70' : 'text-muted-foreground/60',
                )}
              >
                {s.label}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {s.subtitle}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
