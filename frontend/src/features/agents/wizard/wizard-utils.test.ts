import { describe, it, expect } from 'vitest';
import { planToCollectionSettings } from './wizard-utils.ts';
import type { WizardPlan } from '../../../api/types.ts';

function makePlan(overrides: Partial<WizardPlan> = {}): WizardPlan {
  return {
    title: 'Test agent',
    summary: '',
    reasoning: '',
    existing_collection_ids: [],
    new_collection: null,
    agent_type: 'one_shot',
    schedule: null,
    auto_report: true,
    auto_email: false,
    auto_slides: false,
    custom_fields: [],
    enrichment_context: '',
    content_types: [],
    ...overrides,
  };
}

describe('planToCollectionSettings', () => {
  it('enables the new collection and copies its config when the planner returns one', () => {
    const plan = makePlan({
      new_collection: {
        platforms: ['instagram'],
        keywords: ['world cup'],
        channel_urls: [],
        time_range_days: 30,
        geo_scope: 'US',
        n_posts: 1200,
      },
    });

    const result = planToCollectionSettings(plan);

    expect(result.newCollectionEnabled).toBe(true);
    expect(result.platforms).toEqual(['instagram']);
    expect(result.keywords).toEqual(['world cup']);
    expect(result.timeRangeDays).toBe(30);
    expect(result.geoScope).toBe('US');
    expect(result.nPosts).toBe(1200);
  });

  // Regression: the two-call planner sometimes omits new_collection entirely.
  // Previously `newCollectionEnabled = nc !== null` collapsed every source
  // control (platforms / keywords / time window / region / max posts) with no
  // UI affordance to bring them back. A fresh agent with nothing attached must
  // still expose those controls with sensible defaults.
  it('still enables the new collection when the planner omits it and attaches nothing', () => {
    const plan = makePlan({ new_collection: null, existing_collection_ids: [] });

    const result = planToCollectionSettings(plan);

    expect(result.newCollectionEnabled).toBe(true);
    expect(result.platforms.length).toBeGreaterThan(0);
    expect(result.nPosts).toBeGreaterThan(0);
  });

  it('respects the planner only attaching existing collections (no new collection)', () => {
    const plan = makePlan({
      new_collection: null,
      existing_collection_ids: ['col_123'],
    });

    const result = planToCollectionSettings(plan);

    expect(result.newCollectionEnabled).toBe(false);
  });
});
