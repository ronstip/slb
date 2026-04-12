import { PLATFORM_LABELS, buildScheduleFromPreset, formatSchedule } from '../../../lib/constants.ts';
import type { WizardCollectionSettings, WizardAgentSettings } from './AgentCreationWizard.tsx';

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

  // Existing collections to attach (link-only)
  if (collection.existingCollectionIds.length > 0) {
    const ids = JSON.stringify(collection.existingCollectionIds);
    lines.push(`Attach existing collections: ${ids}`);
    lines.push(
      `When calling start_task, pass existing_collection_ids=${ids} so these collections are linked to the new task without re-collecting.`,
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
      `No new collection to create — use only the existing collections listed above. Pass searches=[] to start_task.`,
    );
  }

  // Agent type + schedule
  if (task.taskType === 'recurring') {
    const schedule = buildScheduleFromPreset(task.schedulePreset, task.scheduleTime);
    lines.push(`Schedule: ${formatSchedule(schedule)}`);
  } else {
    lines.push(`Schedule: One-time (run now)`);
  }

  // Outputs
  const outputs: string[] = [];
  if (task.autoReport) outputs.push('report');
  if (task.autoEmail) outputs.push('email');
  if (task.autoSlides) outputs.push('slides');
  if (task.autoDashboard) outputs.push('dashboard');
  if (outputs.length > 0) {
    lines.push(`Auto-generate outputs: ${outputs.join(', ')}`);
  }

  // Enrichment context
  if (collection.enrichmentContext.trim().length > 0) {
    lines.push(`Enrichment context: ${collection.enrichmentContext.trim()}`);
  }

  // Custom enrichment fields — pass as JSON so the agent can forward to start_task
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
      `When calling start_task, pass custom_fields=${json} and enrichment_context from above.`,
    );
  }

  return lines.join('\n');
}
