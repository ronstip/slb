import { create } from 'zustand';
import type { CreateCollectionRequest } from '../api/types.ts';
import { createCollection } from '../api/endpoints/collections.ts';
import { useSourcesStore } from './sources-store.ts';
import { useChatStore } from './chat-store.ts';
import { PLATFORM_LABELS } from '../lib/constants.ts';
import type { WizardConfig, WizardData, WizardFlowType, WizardStepDef } from '../features/chat/wizard/WizardTypes.ts';
import { DEFAULT_WIZARD_DATA } from '../features/chat/wizard/WizardTypes.ts';
import { WIZARD_CONFIGS } from '../features/chat/wizard/wizardConfigs.ts';

export interface WizardStepCardData {
  flowType: WizardFlowType;
  stepIndex: number;
  totalSteps: number;
  stepDef: WizardStepDef;
  status: 'active' | 'completed';
  summary: string | null;
}

interface GuidedFlowStore {
  activeFlow: WizardFlowType | null;
  config: WizardConfig | null;
  currentStepIndex: number;
  data: WizardData;
  submitting: boolean;
  error: string | null;
  /** Message ID of the current active step's agent message */
  activeMessageId: string | null;
  /** Callback for sending the final prompt to the agent (set by ChatPanel) */
  _onSend: ((text: string) => void) | null;

  startFlow: (flowType: WizardFlowType) => void;
  updateData: (partial: Partial<WizardData>) => void;
  advanceStep: () => void;
  cancelFlow: () => void;
  reset: () => void;
  setOnSend: (fn: (text: string) => void) => void;
}

/** Build a human-readable summary for a completed step */
function buildStepSummary(stepDef: WizardStepDef, data: WizardData): string {
  switch (stepDef.component) {
    case 'text_input': {
      const parts = [data.primaryInput.trim()];
      if (data.keywords.length > 0) parts.push(`+ ${data.keywords.join(', ')}`);
      return parts.join(' ');
    }
    case 'tag_input':
      return data.keywords.join(', ');
    case 'platform_select':
      return data.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
    case 'time_range': {
      const range = data.timeRangeDays === 1 ? '24 hours' : `${data.timeRangeDays} days`;
      const parts = [`Last ${range}`, `${data.maxPostsPerKeyword} posts/keyword`];
      if (data.ongoing) parts.push('ongoing monitoring');
      return parts.join(' · ');
    }
    case 'collection_select':
      return `${data.selectedCollectionIds.length} collection${data.selectedCollectionIds.length === 1 ? '' : 's'} selected`;
    default:
      return '';
  }
}

function addStepMessage(config: WizardConfig, stepIndex: number): string {
  const stepDef = config.steps[stepIndex];
  const chatStore = useChatStore.getState();
  const prompt = stepDef.chatPrompt || config.title;
  const msgId = chatStore.addAgentMessage(prompt, [
    {
      type: 'wizard_step',
      data: {
        flowType: config.flowType,
        stepIndex,
        totalSteps: config.steps.length,
        stepDef,
        status: 'active',
        summary: null,
      } as unknown as Record<string, unknown>,
    },
  ]);
  return msgId;
}

async function submitCollectFlow(data: WizardData, config: WizardConfig, onSend: (text: string) => void) {
  const allKeywords = data.primaryInput.trim()
    ? [data.primaryInput.trim(), ...data.keywords]
    : [...data.keywords];

  const scheduleStr = `${data.scheduleIntervalDays}d@${data.scheduleTimeUtc}`;

  const req: CreateCollectionRequest = {
    description: allKeywords.join(', '),
    platforms: data.platforms,
    keywords: allKeywords,
    time_range_days: data.timeRangeDays,
    geo_scope: 'global',
    max_calls: 2,
    max_posts_per_keyword: data.maxPostsPerKeyword,
    include_comments: true,
    ongoing: data.ongoing,
    schedule: data.ongoing ? scheduleStr : undefined,
  };

  const result = await createCollection(req);

  const addSource = useSourcesStore.getState().addSource;
  addSource({
    collectionId: result.collection_id,
    status: 'pending',
    config: {
      platforms: data.platforms,
      keywords: allKeywords,
      channel_urls: [],
      time_range: {
        start: new Date(Date.now() - data.timeRangeDays * 86_400_000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
      max_posts_per_keyword: data.maxPostsPerKeyword,
      include_comments: true,
      geo_scope: 'global',
      ongoing: data.ongoing,
      schedule: data.ongoing ? scheduleStr : undefined,
    },
    title: allKeywords.join(', '),
    postsCollected: 0,
    totalViews: 0,
    positivePct: null,
    selected: true,
    active: true,
    createdAt: new Date().toISOString(),
  });

  const platformNames = data.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
  const kwStr = allKeywords.join(', ');

  useChatStore.getState().addSystemMessage(
    `Collection started: ${kwStr} on ${platformNames} — ${allKeywords.length} keyword${allKeywords.length === 1 ? '' : 's'}, last ${data.timeRangeDays === 1 ? '24 hours' : `${data.timeRangeDays} days`}.`,
    [{ type: 'collection_progress', data: { collection_id: result.collection_id } }],
  );

  onSend(
    `Collection just started for "${kwStr}" on ${platformNames}. Collection ID: ${result.collection_id}. Please monitor the progress and present the results when it's ready.`,
  );
}

function submitAnalyzeFlow(data: WizardData, config: WizardConfig, onSend: (text: string) => void) {
  const store = useSourcesStore.getState();
  for (const id of data.selectedCollectionIds) {
    store.addToSession(id);
  }

  const promptMap: Record<string, string> = {
    build_dashboard: 'Build a dashboard from my collected data',
    generate_report: 'Generate a marketing report from my collected data',
    setup_scheduled_report: 'Set up a daily or weekly report from my collected data',
  };

  onSend(promptMap[config.flowType] || 'Analyze my collected data');
}

export const useGuidedFlowStore = create<GuidedFlowStore>((set, get) => ({
  activeFlow: null,
  config: null,
  currentStepIndex: 0,
  data: { ...DEFAULT_WIZARD_DATA },
  submitting: false,
  error: null,
  activeMessageId: null,
  _onSend: null,

  setOnSend: (fn) => set({ _onSend: fn }),

  startFlow: (flowType) => {
    const config = WIZARD_CONFIGS[flowType];
    if (!config) return;

    const data = { ...DEFAULT_WIZARD_DATA, ...config.defaults };

    set({
      activeFlow: flowType,
      config,
      currentStepIndex: 0,
      data,
      submitting: false,
      error: null,
    });

    // Add the first agent message with the wizard step card
    const msgId = addStepMessage(config, 0);
    set({ activeMessageId: msgId });
  },

  updateData: (partial) => {
    set((s) => ({ data: { ...s.data, ...partial } }));
  },

  advanceStep: () => {
    const { config, currentStepIndex, data, activeMessageId, _onSend, submitting } = get();
    if (!config || submitting) return;

    const currentStepDef = config.steps[currentStepIndex];
    const summary = buildStepSummary(currentStepDef, data);

    // Mark current card as completed
    if (activeMessageId) {
      useChatStore.getState().updateCard(activeMessageId, 0, { status: 'completed', summary });
    }

    // Add user message with the summary
    useChatStore.getState().sendUserMessage(summary);

    const isLastStep = currentStepIndex === config.steps.length - 1;

    if (isLastStep) {
      // Submit the flow
      set({ submitting: true });

      const onSend = _onSend;
      if (!onSend) {
        set({ error: 'No send handler available', submitting: false });
        return;
      }

      if (config.category === 'collect') {
        submitCollectFlow(data, config, onSend)
          .then(() => {
            set({
              activeFlow: null,
              config: null,
              currentStepIndex: 0,
              data: { ...DEFAULT_WIZARD_DATA },
              submitting: false,
              error: null,
              activeMessageId: null,
            });
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : 'Failed to create collection';
            set({ error: message, submitting: false });
          });
      } else {
        submitAnalyzeFlow(data, config, onSend);
        set({
          activeFlow: null,
          config: null,
          currentStepIndex: 0,
          data: { ...DEFAULT_WIZARD_DATA },
          submitting: false,
          error: null,
          activeMessageId: null,
        });
      }
    } else {
      // Advance to next step with a brief delay for natural feel
      const nextIndex = currentStepIndex + 1;
      set({ currentStepIndex: nextIndex, activeMessageId: null });

      setTimeout(() => {
        const msgId = addStepMessage(config, nextIndex);
        set({ activeMessageId: msgId });
      }, 300);
    }
  },

  cancelFlow: () => {
    // Clear all guided flow messages from chat
    const chatStore = useChatStore.getState();
    chatStore.clearMessages();

    set({
      activeFlow: null,
      config: null,
      currentStepIndex: 0,
      data: { ...DEFAULT_WIZARD_DATA },
      submitting: false,
      error: null,
      activeMessageId: null,
    });
  },

  reset: () => {
    set({
      activeFlow: null,
      config: null,
      currentStepIndex: 0,
      data: { ...DEFAULT_WIZARD_DATA },
      submitting: false,
      error: null,
      activeMessageId: null,
    });
  },
}));
