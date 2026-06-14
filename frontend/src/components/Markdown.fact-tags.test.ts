import { describe, it, expect } from 'vitest';
import { stripFactTags } from './Markdown.tsx';

// `<fact src="metric_key">value</fact>` provenance tags wrap load-bearing
// numbers so the agent's verify tools can re-derive them. The render layer must
// drop the wrapper and keep the inner value visible (otherwise the reader sees
// the raw markup, since <fact> is not an allowed HTML tag).

describe('stripFactTags', () => {
  it('replaces a fact tag with its inner value', () => {
    expect(stripFactTags('Nike is <fact src="pct:entity:Nike">26%</fact> of voice.'))
      .toBe('Nike is 26% of voice.');
  });

  it('handles multiple tags and varied attributes/casing', () => {
    const md = 'A <fact src="pct:theme:Eco">40%</fact> and B <FACT src="total_posts">12,345</FACT>.';
    expect(stripFactTags(md)).toBe('A 40% and B 12,345.');
  });

  it('leaves text without fact tags unchanged', () => {
    expect(stripFactTags('No tags here.')).toBe('No tags here.');
  });

  it('strips topic-dimension fact tags', () => {
    expect(stripFactTags('Topic at <fact src="pct:topic:clust-9">55%</fact>.'))
      .toBe('Topic at 55%.');
  });
});
