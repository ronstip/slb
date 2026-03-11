export type WizardFlowType =
  | 'brand_search'
  | 'event_search'
  | 'competitor_search'
  | 'trending_topic'
  | 'build_dashboard'
  | 'generate_report'
  | 'setup_scheduled_report';

export type WizardCategory = 'collect' | 'analyze';

export type StepComponent =
  | 'text_input'
  | 'tag_input'
  | 'platform_select'
  | 'time_range'
  | 'collection_select';

export interface StepProps {
  textLabel?: string;
  textPlaceholder?: string;
  tagLabel?: string;
  tagPlaceholder?: string;
  showOngoing?: boolean;
}

export interface WizardStepDef {
  id: string;
  component: StepComponent;
  props: StepProps;
  chatPrompt?: string;
}

export interface WizardConfig {
  flowType: WizardFlowType;
  category: WizardCategory;
  title: string;
  icon: 'search' | 'bar-chart';
  steps: WizardStepDef[];
  defaults: Partial<WizardData>;
}

export interface WizardData {
  primaryInput: string;
  keywords: string[];
  platforms: string[];
  timeRangeDays: number;
  maxPostsPerKeyword: number;
  ongoing: boolean;
  scheduleIntervalDays: number;
  scheduleTimeUtc: string;
  selectedCollectionIds: string[];
}

export const DEFAULT_WIZARD_DATA: WizardData = {
  primaryInput: '',
  keywords: [],
  platforms: ['instagram', 'tiktok'],
  timeRangeDays: 90,
  maxPostsPerKeyword: 20,
  ongoing: false,
  scheduleIntervalDays: 1,
  scheduleTimeUtc: '09:00',
  selectedCollectionIds: [],
};
