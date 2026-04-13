import { apiPost } from '../client.ts';
import type { WizardPlannerResponse } from '../types.ts';

export async function planWizard(
  description: string,
  priorAnswers?: Record<string, string[]>,
): Promise<WizardPlannerResponse> {
  return apiPost('/wizard/plan', { description, prior_answers: priorAnswers });
}
