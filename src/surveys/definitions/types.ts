import { UserRole } from '../../types/index.js';

/** Survey copy in every language the web client offers. English is the source. */
export interface Localized {
  en: string;
  ha: string;
  yo: string;
  ig: string;
}

export interface SurveyOption {
  id: string;
  label: Localized;
  /** Choosing it asks for a short "please specify" text, stored as `other`. */
  other?: true;
  /** Choosing it clears every other option (e.g. "Nothing in particular"). */
  exclusive?: true;
}

/**
 * Shows a question only when an earlier one has been answered with (`anyOf`) or
 * without (`noneOf`) one of the listed options. Unanswered never matches.
 */
export interface ShowIf {
  question: string;
  anyOf?: string[];
  noneOf?: string[];
}

export type QuestionKind = 'single' | 'multi' | 'text' | 'list';

export interface SurveyQuestion {
  /** Stable id: answers and CSV columns are keyed by it. Never reuse one for a different question. */
  id: string;
  kind: QuestionKind;
  prompt: Localized;
  help?: Localized;
  /** For `single` and `multi`. */
  options?: SurveyOption[];
  /** For `list`: how many text boxes to show. */
  items?: number;
  required: boolean;
  showIf?: ShowIf;
}

export type SurveyId = 'customer-v1' | 'merchant-v1' | 'tailor-v1';

/**
 * One versioned form. Editing questions in a way that changes their meaning
 * means a new id (e.g. `customer-v2`) so earlier answers stay interpretable.
 */
export interface SurveyDefinition {
  id: SurveyId;
  role: UserRole.CUSTOMER | UserRole.MERCHANT | UserRole.TAILOR;
  title: Localized;
  intro: Localized;
  questions: SurveyQuestion[];
}

/** One stored answer. `value` is an option id (single), option ids (multi), text, or list items. */
export interface SurveyAnswer {
  value: string | string[];
  other?: string;
}

export type SurveyAnswers = Record<string, SurveyAnswer>;

export const l = (en: string, ha: string, yo: string, ig: string): Localized => ({ en, ha, yo, ig });
