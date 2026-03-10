import type { WizardConfig, WizardFlowType } from './WizardTypes.ts';

export const WIZARD_CONFIGS: Record<WizardFlowType, WizardConfig> = {
  brand_search: {
    flowType: 'brand_search',
    category: 'collect',
    title: 'Search posts about your brand',
    icon: 'search',
    steps: [
      {
        id: 'brand-input',
        component: 'text_input',
        props: {
          textLabel: "What's your brand name?",
          textPlaceholder: 'e.g., Glossier',
          tagLabel: 'Additional keywords (optional)',
          tagPlaceholder: 'e.g., skincare, beauty',
        },
      },
      { id: 'platforms', component: 'platform_select', props: {} },
      { id: 'time-range', component: 'time_range', props: {} },
    ],
    defaults: { platforms: ['instagram', 'tiktok'], timeRangeDays: 90, maxPostsPerKeyword: 20 },
  },

  event_search: {
    flowType: 'event_search',
    category: 'collect',
    title: 'Search posts about an event',
    icon: 'search',
    steps: [
      {
        id: 'event-input',
        component: 'text_input',
        props: {
          textLabel: "What's the event?",
          textPlaceholder: 'e.g., Apple WWDC 2026',
          tagLabel: 'Related keywords (optional)',
          tagPlaceholder: 'e.g., keynote, iOS',
        },
      },
      { id: 'platforms', component: 'platform_select', props: {} },
      { id: 'time-range', component: 'time_range', props: {} },
    ],
    defaults: { platforms: ['instagram', 'tiktok', 'twitter'], timeRangeDays: 7, maxPostsPerKeyword: 20 },
  },

  competitor_search: {
    flowType: 'competitor_search',
    category: 'collect',
    title: 'Search posts about your competitors',
    icon: 'search',
    steps: [
      {
        id: 'competitors-input',
        component: 'tag_input',
        props: {
          tagLabel: 'Who are your competitors?',
          tagPlaceholder: 'Type a name + Enter',
        },
      },
      { id: 'platforms', component: 'platform_select', props: {} },
      { id: 'time-range', component: 'time_range', props: {} },
    ],
    defaults: { platforms: ['instagram', 'tiktok'], timeRangeDays: 90, maxPostsPerKeyword: 20 },
  },

  trending_topic: {
    flowType: 'trending_topic',
    category: 'collect',
    title: 'Monitor a trending topic',
    icon: 'search',
    steps: [
      {
        id: 'topic-input',
        component: 'text_input',
        props: {
          textLabel: "What's the topic?",
          textPlaceholder: 'e.g., AI in healthcare',
          tagLabel: 'Related hashtags or keywords (optional)',
          tagPlaceholder: 'e.g., #AIhealth, medtech',
        },
      },
      { id: 'platforms', component: 'platform_select', props: {} },
      { id: 'time-range', component: 'time_range', props: { showOngoing: true } },
    ],
    defaults: { platforms: ['twitter', 'reddit', 'tiktok'], timeRangeDays: 7, maxPostsPerKeyword: 20, ongoing: true },
  },

  build_dashboard: {
    flowType: 'build_dashboard',
    category: 'analyze',
    title: 'Build a dashboard',
    icon: 'bar-chart',
    steps: [
      { id: 'collections', component: 'collection_select', props: {} },
    ],
    defaults: {},
  },

  generate_report: {
    flowType: 'generate_report',
    category: 'analyze',
    title: 'Generate a report',
    icon: 'bar-chart',
    steps: [
      { id: 'collections', component: 'collection_select', props: {} },
    ],
    defaults: {},
  },

  setup_scheduled_report: {
    flowType: 'setup_scheduled_report',
    category: 'analyze',
    title: 'Set up a scheduled report',
    icon: 'bar-chart',
    steps: [
      { id: 'collections', component: 'collection_select', props: {} },
    ],
    defaults: {},
  },
};
