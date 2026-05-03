import { PLATFORM_LABELS, buildScheduleString, formatSchedule } from '../../../lib/constants.ts';
import type { WizardCollectionSettings, WizardAgentSettings } from './AgentCreationWizard.tsx';
import type { Constitution, CreateFromWizardPayload, Source } from '../../../api/endpoints/agents.ts';

function intervalHoursToSchedule(hours: number, time: string): string {
  if (hours < 24) return buildScheduleString('hour', hours, time);
  return buildScheduleString('day', Math.round(hours / 24), time);
}

interface FormatOptions {
  title?: string;
}

export function formatWizardAsPrompt(
  description: string,
  collection: WizardCollectionSettings,
  task: WizardAgentSettings,
  options: FormatOptions = {},
): string {
  const lines: string[] = [];

  lines.push(`Create a new monitoring agent:`);
  if (options.title) {
    lines.push(`Title: ${options.title.trim()}`);
  }
  lines.push(`Description: ${description.trim()}`);

  // Existing agent data to attach
  if (collection.existingAgentIds.length > 0) {
    const ids = JSON.stringify(collection.existingAgentIds);
    lines.push(`Attach data from existing agents: ${ids}`);
    lines.push(
      `When calling start_agent, pass existing_agent_ids=${ids} so data from these agents is linked to the new agent.`,
    );
  }

  // New collection config (only when user enabled it)
  if (collection.newCollectionEnabled) {
    const platformNames = collection.platforms.map((p) => PLATFORM_LABELS[p] || p);
    lines.push(`Platforms: ${platformNames.join(', ')}`);

    if (collection.keywords.length > 0) {
      lines.push(`Keywords: ${collection.keywords.map((k) => `"${k}"`).join(', ')}`);
    }

    if (collection.channelUrls.length > 0) {
      lines.push(`Channels: ${collection.channelUrls.join(', ')}`);
    }

    const rangeLabel =
      collection.timeRangeDays === 1
        ? '24 hours'
        : collection.timeRangeDays === 365
          ? '1 year'
          : `${collection.timeRangeDays} days`;
    lines.push(`Time Range: Last ${rangeLabel}`);

    if (collection.geoScope !== 'global') {
      lines.push(`Region: ${collection.geoScope}`);
    }

    if (collection.nPosts > 0) {
      lines.push(`Posts: ${collection.nPosts}`);
    }
  } else {
    lines.push(
      `No new collection to create — use only the existing collections listed above. Pass searches=[] to start_agent.`,
    );
  }

  // Agent type + schedule
  if (task.taskType === 'recurring') {
    const schedule = intervalHoursToSchedule(task.scheduleIntervalHours, task.scheduleTime);
    lines.push(`Schedule: ${formatSchedule(schedule)}`);
  } else {
    lines.push(`Schedule: One-time (run now)`);
  }

  // Outputs
  if (task.outputs.length > 0) {
    const labels = task.outputs.map((o) => o.type);
    lines.push(`Auto-generate outputs: ${labels.join(', ')}`);
  }

  // Enrichment context
  if (collection.enrichmentContext.trim().length > 0) {
    lines.push(`Enrichment context: ${collection.enrichmentContext.trim()}`);
  }

  // Custom enrichment fields — pass as JSON so the agent can forward to start_agent
  if (collection.customFields.length > 0) {
    const compact = collection.customFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
      ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
    }));
    const json = JSON.stringify(compact);
    lines.push(`Custom enrichment fields: ${json}`);
    lines.push(
      `When calling start_agent, pass custom_fields=${json} and enrichment_context from above.`,
    );
  }

  return lines.join('\n');
}

export function buildWizardRequestBody(
  description: string,
  collection: WizardCollectionSettings,
  task: WizardAgentSettings,
  title: string,
  constitution?: Constitution,
  startRun: boolean = true,
): CreateFromWizardPayload {
  // Wizard creates one Source per selected platform — same shared defaults
  // baked into each. Users can later edit each source independently in
  // Settings → Data Sources, or add additional sources for the same platform
  // (e.g. two Twitter sources with different keywords / quotas).
  const sources: Source[] = [];
  if (collection.newCollectionEnabled && collection.platforms.length > 0) {
    const platformCount = collection.platforms.length;
    const perSourcePosts = collection.nPosts
      ? Math.round(collection.nPosts / platformCount)
      : 0;
    for (const platform of collection.platforms) {
      sources.push({
        platform,
        keywords: [...collection.keywords],
        ...(collection.channelUrls.length > 0 ? { channels: [...collection.channelUrls] } : {}),
        time_range_days: collection.timeRangeDays,
        geo_scope: collection.geoScope,
        n_posts: perSourcePosts,
      });
    }
  }

  // Build schedule for recurring tasks
  let schedule: CreateFromWizardPayload['schedule'] = null;
  if (task.taskType === 'recurring') {
    const frequency = intervalHoursToSchedule(task.scheduleIntervalHours, task.scheduleTime);
    schedule = {
      frequency,
      frequency_label: formatSchedule(frequency),
    };
  }

  // Build custom fields
  const customFields = collection.customFields.length > 0
    ? collection.customFields.map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
        ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
      }))
    : undefined;

  return {
    title: title.trim() || 'New agent',
    description: description.trim(),
    agent_type: task.taskType === 'recurring' ? 'recurring' : 'one_shot',
    sources,
    schedule,
    custom_fields: customFields,
    enrichment_context: collection.enrichmentContext.trim() || undefined,
    content_types: collection.contentTypes.length > 0 ? collection.contentTypes : undefined,
    constitution: constitution && Object.values(constitution).some((v) => v) ? constitution : undefined,
    existing_agent_ids: collection.existingAgentIds.length > 0
      ? collection.existingAgentIds
      : undefined,
    outputs: task.outputs,
    start_run: startRun,
  };
}
