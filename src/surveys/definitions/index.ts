import { UserRole } from '../../types/index.js';
import { customerSurvey } from './customer.js';
import { merchantSurvey } from './merchant.js';
import { tailorSurvey } from './tailor.js';
import type { SurveyDefinition } from './types.js';

export * from './types.js';

/** Every survey, in the order admins see them. */
export const SURVEYS: readonly SurveyDefinition[] = [customerSurvey, tailorSurvey, merchantSurvey];

/** The current form for a role, or null for roles without one (admins). */
export function surveyForRole(role: UserRole): SurveyDefinition | null {
  return SURVEYS.find((survey) => survey.role === role) ?? null;
}

export function surveyById(id: string): SurveyDefinition | null {
  return SURVEYS.find((survey) => survey.id === id) ?? null;
}
