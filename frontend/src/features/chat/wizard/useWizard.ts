import { useState, useCallback, useMemo } from 'react';
import type { CreateCollectionRequest } from '../../../api/types.ts';
import { createCollection } from '../../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { PLATFORM_LABELS } from '../../../lib/constants.ts';
import type { WizardConfig, WizardData } from './WizardTypes.ts';
import { DEFAULT_WIZARD_DATA } from './WizardTypes.ts';

interface UseWizardOptions {
  config: WizardConfig;
  onSend: (text: string) => void;
}

export function useWizard({ config, onSend }: UseWizardOptions) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [data, setData] = useState<WizardData>({
    ...DEFAULT_WIZARD_DATA,
    ...config.defaults,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = config.steps.length;
  const currentStepDef = config.steps[currentStepIndex];
  const isLastStep = currentStepIndex === totalSteps - 1;

  const updateData = useCallback((partial: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const canGoNext = useMemo(() => {
    switch (currentStepDef.component) {
      case 'text_input':
        return data.primaryInput.trim().length > 0;
      case 'tag_input':
        return data.keywords.length > 0;
      case 'platform_select':
        return data.platforms.length > 0;
      case 'time_range':
        return true;
      case 'collection_select':
        return data.selectedCollectionIds.length > 0;
      default:
        return true;
    }
  }, [currentStepDef.component, data]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    if (isLastStep) return;
    setCurrentStepIndex((i) => i + 1);
  }, [canGoNext, isLastStep]);

  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((i) => i - 1);
    }
  }, [currentStepIndex]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (config.category === 'collect') {
        // Build keywords: primaryInput is always the first keyword
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

        // Add system message with embedded collection progress card for immediate visual feedback
        useChatStore.getState().addSystemMessage(
          `Collection started: ${kwStr} on ${platformNames} — ${allKeywords.length} keyword${allKeywords.length === 1 ? '' : 's'}, last ${data.timeRangeDays === 1 ? '24 hours' : `${data.timeRangeDays} days`}.`,
          [{ type: 'collection_progress', data: { collection_id: result.collection_id } }],
        );

        // Also send to agent — this creates a backend session and lets the agent
        // track the collection + generate dashboard/data table when done
        onSend(
          `Collection just started for "${kwStr}" on ${platformNames}. Collection ID: ${result.collection_id}. Please monitor the progress and present the results when it's ready.`,
        );
      } else {
        // Analyze flow: activate selected collections and send structured prompt
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create collection';
      setError(message);
      setSubmitting(false);
    }
  }, [submitting, config, data, onSend]);

  return {
    currentStepIndex,
    totalSteps,
    currentStepDef,
    isLastStep,
    data,
    updateData,
    canGoNext,
    goNext,
    goBack,
    submit,
    submitting,
    error,
  };
}
