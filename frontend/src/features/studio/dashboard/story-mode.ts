/**
 * Story-mode message builder for the AI Co-Author.
 *
 * `outgoing` is what the model receives - a `[STORY REQUEST]` preamble that
 * triggers the Story Mode section of the report-editor / chat prompts (see
 * api/agent/prompts/story_mode.py). `display` is the friendly form shown in
 * the user's chat bubble.
 */
/** A picked topic chip. `id` is the cluster id (topic_id) when known - passing
 *  it lets the agent set `filters.topics=[id]` directly instead of guessing. */
export interface StoryTopic {
  name: string;
  id?: string;
}

export interface StoryRequest {
  /** Suggested topic chips the user picked (selection order = section order).
   *  Accepts plain names (legacy) or {name, id} so the topic_id can be passed
   *  through to the agent. */
  topics?: Array<string | StoryTopic>;
  /** A freeform brief the user typed describing the angle they want. */
  brief?: string;
}

const WORKFLOW_TAIL =
  'Follow your Story Mode workflow: ground every number in real data, then apply ONE batched update_dashboard.';

function normalizeTopics(raw: Array<string | StoryTopic> | undefined): StoryTopic[] {
  return (raw ?? [])
    .map((t) => (typeof t === 'string' ? { name: t } : t))
    .map((t) => ({ name: (t.name ?? '').trim(), id: t.id?.trim() || undefined }))
    .filter((t) => t.name);
}

export function buildStoryMessage(request: StoryRequest | string[]): {
  outgoing: string;
  display: string;
} {
  // Accept the legacy string[] form (topic chips only) as well as the
  // {topics, brief} object so freeform briefs can be threaded in.
  const { topics: rawTopics, brief: rawBrief }: StoryRequest = Array.isArray(request)
    ? { topics: request }
    : request;
  const topics = normalizeTopics(rawTopics);
  const brief = (rawBrief ?? '').trim();

  // When a topic carries its cluster id, tell the agent to scope that section's
  // charts with filters.topics=[id] - removes the name→id guessing that
  // otherwise pushes it toward an invalid keyword filter.
  const sectionList = topics
    .map((t, i) => (t.id ? `${i + 1}. ${t.name} (topic_id: ${t.id})` : `${i + 1}. ${t.name}`))
    .join('; ');
  const anyId = topics.some((t) => t.id);
  const sections = topics.length
    ? ` covering these angles as ordered sections: ${sectionList}.` +
      (anyId
        ? " For each section, set its chart's filters.topics to that section's topic_id so the chart measures only that topic."
        : '')
    : '';
  const displayNames = topics.map((t) => t.name).join(', ');

  if (brief) {
    // A user-provided brief is the governing angle, even when topic chips are
    // also selected (chips then become the ordered sections within that brief).
    return {
      outgoing:
        '[STORY REQUEST] Turn this dashboard into a single scrolling narrative story ' +
        `built around this brief: "${brief}".${sections} ${WORKFLOW_TAIL}`,
      display: `Tell the story: ${brief}`,
    };
  }

  if (topics.length === 0) {
    return {
      outgoing:
        '[STORY REQUEST] Turn this dashboard into a single scrolling narrative story. ' +
        'Pick the strongest angle yourself from the data. ' +
        WORKFLOW_TAIL,
      display: 'Find the story this dashboard tells',
    };
  }

  return {
    outgoing:
      '[STORY REQUEST] Turn this dashboard into a single scrolling narrative story' +
      `${sections} ${WORKFLOW_TAIL}`,
    display: `Tell the story of: ${displayNames}`,
  };
}
