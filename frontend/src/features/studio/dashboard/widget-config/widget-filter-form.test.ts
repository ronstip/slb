import { describe, it, expect } from 'vitest';
import { buildTopicFilterOptions } from './WidgetFilterForm.tsx';
import type { DashboardPost, TopicMetric } from '../../../../api/types.ts';

function topic(cluster_id: string, header: string): TopicMetric {
  return {
    cluster_id, header, keywords: [], post_count: 0,
    total_views: 0, total_likes: 0, total_comments: 0,
  } as TopicMetric;
}
function post(topic_ids: string[]): DashboardPost {
  return { topic_ids } as unknown as DashboardPost;
}

describe('buildTopicFilterOptions', () => {
  it('maps cluster ids to topic header names', () => {
    const { options, labels } = buildTopicFilterOptions(
      [topic('a', 'Artan Crisis'), topic('b', 'Qatar Comparison')],
      [],
      [],
    );
    expect(options).toEqual(['a', 'b']);
    expect(labels.get('a')).toBe('Artan Crisis');
    expect(labels.get('b')).toBe('Qatar Comparison');
  });

  it('counts posts per topic and orders by count desc', () => {
    const { options, counts } = buildTopicFilterOptions(
      [topic('a', 'A'), topic('b', 'B')],
      [post(['b']), post(['b']), post(['a'])],
      [],
    );
    expect(counts.get('b')).toBe(2);
    expect(counts.get('a')).toBe(1);
    expect(options[0]).toBe('b'); // higher count first
  });

  it('includes an active selection even if it is not in the topics list', () => {
    // The agent-applied scope must still be visible/clearable when the topic
    // list is empty or stale - otherwise it shows only as a phantom "(1)".
    const { options, labels } = buildTopicFilterOptions(undefined, [], ['ghost-id']);
    expect(options).toContain('ghost-id');
    expect(labels.get('ghost-id')).toBeUndefined(); // falls back to raw id in UI
  });

  it('falls back to the cluster id when the header is blank', () => {
    const { labels } = buildTopicFilterOptions([topic('a', '  ')], [], []);
    expect(labels.get('a')).toBe('a');
  });
});
