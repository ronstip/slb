import { PLATFORM_LABELS, buildScheduleFromPreset, formatSchedule } from '../../../lib/constants.ts';
import type { WizardCollectionSettings, WizardAgentSettings } from './AgentCreationWizard.tsx';

export function formatWizardAsPrompt(
  description: string,
  collection: WizardCollectionSettings,
  task: WizardAgentSettings,
): string {
  const lines: string[] = [];

  lines.push(`Create a new monitoring agent:`);
  lines.push(`Description: ${description.trim()}`);

  // Platforms
  const platformNames = collection.platforms.map((p) => PLATFORM_LABELS[p] || p);
  lines.push(`Platforms: ${platformNames.join(', ')}`);

  // Keywords (optional — agent can extract from description if empty)
  if (collection.keywords.length > 0) {
    lines.push(`Keywords: ${collection.keywords.map((k) => `"${k}"`).join(', ')}`);
  }

  // Channel URLs
  if (collection.channelUrls.length > 0) {
    lines.push(`Channels: ${collection.channelUrls.join(', ')}`);
  }

  // Time range
  const rangeLabel =
    collection.timeRangeDays === 1 ? '24 hours' :
    collection.timeRangeDays === 365 ? '1 year' :
    `${collection.timeRangeDays} days`;
  lines.push(`Time Range: Last ${rangeLabel}`);

  // Region
  if (collection.geoScope !== 'global') {
    lines.push(`Region: ${collection.geoScope}`);
  }

  // Posts limit
  if (collection.nPosts > 0) {
    lines.push(`Posts: ${collection.nPosts}`);
  }

  // Agent type + schedule
  if (task.taskType === 'recurring') {
    const schedule = buildScheduleFromPreset(task.schedulePreset, task.scheduleTime);
    lines.push(`Schedule: ${formatSchedule(schedule)}`);
  } else {
    lines.push(`Schedule: One-time (run now)`);
  }

  // Auto-report
  if (task.autoReport) {
    lines.push(`Auto-report: Yes`);
  }

  return lines.join('\n');
}
