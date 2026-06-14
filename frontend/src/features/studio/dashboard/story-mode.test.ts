import { describe, it, expect } from 'vitest';
import { buildStoryMessage } from './story-mode.ts';

describe('buildStoryMessage', () => {
  it('builds a [STORY REQUEST] outgoing message listing the selected topics in order', () => {
    const { outgoing, display } = buildStoryMessage(['Nike ambush', 'Adidas sponsorship']);
    expect(outgoing.startsWith('[STORY REQUEST]')).toBe(true);
    // Ordered sections - order of selection is the section order.
    expect(outgoing.indexOf('Nike ambush')).toBeLessThan(outgoing.indexOf('Adidas sponsorship'));
    // Friendly bubble text, no protocol preamble.
    expect(display).not.toContain('[STORY REQUEST]');
    expect(display).toContain('Nike ambush');
    expect(display).toContain('Adidas sponsorship');
  });

  it('falls back to a find-the-story request when no topics are selected', () => {
    const { outgoing, display } = buildStoryMessage([]);
    expect(outgoing.startsWith('[STORY REQUEST]')).toBe(true);
    expect(display.toLowerCase()).toContain('story');
    expect(display).not.toContain('[STORY REQUEST]');
  });

  it('mentions the story-mode workflow so the agent follows its prompt section', () => {
    const { outgoing } = buildStoryMessage(['Topic A']);
    expect(outgoing).toContain('Story Mode');
  });

  it('accepts the {topics} object form equivalently to the legacy array form', () => {
    const fromArray = buildStoryMessage(['Topic A', 'Topic B']);
    const fromObject = buildStoryMessage({ topics: ['Topic A', 'Topic B'] });
    expect(fromObject.outgoing).toBe(fromArray.outgoing);
  });

  it('embeds a freeform brief as the governing angle', () => {
    const { outgoing, display } = buildStoryMessage({ brief: 'how sentiment shifted after the launch' });
    expect(outgoing.startsWith('[STORY REQUEST]')).toBe(true);
    expect(outgoing).toContain('how sentiment shifted after the launch');
    expect(outgoing).toContain('Story Mode');
    expect(display).toContain('how sentiment shifted after the launch');
    expect(display).not.toContain('[STORY REQUEST]');
  });

  it('combines a brief with selected topic chips as ordered sections', () => {
    const { outgoing } = buildStoryMessage({
      topics: ['Nike ambush', 'Adidas sponsorship'],
      brief: 'the ambush-marketing angle',
    });
    expect(outgoing).toContain('the ambush-marketing angle');
    expect(outgoing.indexOf('Nike ambush')).toBeLessThan(outgoing.indexOf('Adidas sponsorship'));
  });

  it('embeds each topic_id and instructs filters.topics when ids are provided', () => {
    const { outgoing } = buildStoryMessage({
      topics: [
        { name: 'Artan visa crisis', id: 'clust-1' },
        { name: 'Qatar contrast', id: 'clust-2' },
      ],
    });
    expect(outgoing).toContain('topic_id: clust-1');
    expect(outgoing).toContain('topic_id: clust-2');
    expect(outgoing).toContain('filters.topics');
    // Section order preserved.
    expect(outgoing.indexOf('clust-1')).toBeLessThan(outgoing.indexOf('clust-2'));
  });

  it('omits the topic_id instruction for legacy name-only topics', () => {
    const { outgoing } = buildStoryMessage({ topics: [{ name: 'Topic A' }] });
    expect(outgoing).not.toContain('topic_id:');
    expect(outgoing).not.toContain('filters.topics');
  });

  it('falls back to find-the-story when both brief and topics are empty', () => {
    const { outgoing, display } = buildStoryMessage({ topics: [], brief: '' });
    expect(outgoing.startsWith('[STORY REQUEST]')).toBe(true);
    expect(display.toLowerCase()).toContain('story');
  });
});
