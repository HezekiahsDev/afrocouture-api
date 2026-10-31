import type { SurveyAnswer, SurveyAnswers, SurveyDefinition, SurveyQuestion } from './definitions/index.js';

/**
 * Branching and validation rules for surveys. Pure functions, so the same rules
 * are easy to test and the web client mirrors them (src/lib/survey.ts there).
 */

export const MAX_TEXT = 2000;
export const MAX_SHORT_TEXT = 500;

/** Option ids picked in an answer (empty for text answers and unanswered questions). */
function picked(answer: SurveyAnswer | undefined): string[] {
  if (!answer) return [];
  return Array.isArray(answer.value) ? answer.value : [answer.value];
}

function isShown(question: SurveyQuestion, answers: SurveyAnswers): boolean {
  const rule = question.showIf;
  if (!rule) return true;
  const chosen = picked(answers[rule.question]);
  if (!chosen.length) return false;
  if (rule.anyOf && !chosen.some((id) => rule.anyOf!.includes(id))) return false;
  if (rule.noneOf && chosen.some((id) => rule.noneOf!.includes(id))) return false;
  return true;
}

/**
 * Questions the person should see given their answers, in order. Rules only point
 * at earlier questions, so walking in order also hides follow-ups of follow-ups.
 */
export function visibleQuestions(survey: SurveyDefinition, answers: SurveyAnswers): SurveyQuestion[] {
  const kept: SurveyAnswers = {};
  const visible: SurveyQuestion[] = [];
  for (const question of survey.questions) {
    if (!isShown(question, kept)) continue;
    visible.push(question);
    if (answers[question.id]) kept[question.id] = answers[question.id];
  }
  return visible;
}

export function isAnswered(question: SurveyQuestion, answer: SurveyAnswer | undefined): boolean {
  if (!answer) return false;
  const needsOther = picked(answer).some((id) => question.options?.find((o) => o.id === id)?.other);
  if (needsOther && !answer.other?.trim()) return false;
  switch (question.kind) {
    case 'single':
    case 'text':
      return typeof answer.value === 'string' && answer.value.trim() !== '';
    case 'multi':
      return Array.isArray(answer.value) && answer.value.length > 0;
    case 'list':
      return Array.isArray(answer.value) && answer.value.some((item) => item.trim() !== '');
  }
}

/** Keeps answers only for questions that are still visible (e.g. after an earlier answer changed). */
export function sanitizeAnswers(survey: SurveyDefinition, answers: SurveyAnswers): SurveyAnswers {
  const out: SurveyAnswers = {};
  for (const question of visibleQuestions(survey, answers)) {
    const answer = answers[question.id];
    if (answer) out[question.id] = answer;
  }
  return out;
}

/** Ids of visible required questions that have no usable answer yet. */
export function missingRequired(survey: SurveyDefinition, answers: SurveyAnswers): string[] {
  return visibleQuestions(survey, answers)
    .filter((question) => question.required && !isAnswered(question, answers[question.id]))
    .map((question) => question.id);
}

export interface AnswerProblem {
  question: string;
  message: string;
}

/**
 * Checks the shape of one answer and normalises it (trims text, drops empty list
 * items). Returns null when the answer is empty and should simply be cleared.
 */
export function normaliseAnswer(question: SurveyQuestion, raw: unknown): SurveyAnswer | null | string {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'Send an object with a `value`.';
  const { value, other } = raw as { value?: unknown; other?: unknown };
  if (other !== undefined && typeof other !== 'string') return '`other` must be text.';
  const otherText = typeof other === 'string' ? other.trim() : '';
  if (otherText.length > MAX_SHORT_TEXT) return `Keep "other" under ${MAX_SHORT_TEXT} characters.`;
  const optionIds = new Set(question.options?.map((o) => o.id));

  switch (question.kind) {
    case 'text': {
      if (typeof value !== 'string') return 'This question takes text.';
      const text = value.trim();
      if (text.length > MAX_TEXT) return `Keep this under ${MAX_TEXT} characters.`;
      return text ? { value: text } : null;
    }
    case 'list': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return 'This question takes a list of text.';
      if (value.length > (question.items ?? 3)) return `Give at most ${question.items ?? 3} items.`;
      const items = (value as string[]).map((item) => item.trim());
      if (items.some((item) => item.length > MAX_SHORT_TEXT)) return `Keep each item under ${MAX_SHORT_TEXT} characters.`;
      return items.some(Boolean) ? { value: items } : null;
    }
    case 'single': {
      if (typeof value !== 'string') return 'Choose one option.';
      if (!optionIds.has(value)) return 'That option is not part of this question.';
      const option = question.options!.find((o) => o.id === value)!;
      if (otherText && !option.other) return '`other` is only for the "Other" option.';
      return option.other && otherText ? { value, other: otherText } : { value };
    }
    case 'multi': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return 'Choose one or more options.';
      const ids = [...new Set(value as string[])];
      if (ids.some((id) => !optionIds.has(id))) return 'One of those options is not part of this question.';
      const exclusive = question.options!.filter((o) => o.exclusive && ids.includes(o.id));
      if (exclusive.length && ids.length > 1) return `"${exclusive[0].label.en}" can't be combined with other options.`;
      const hasOther = question.options!.some((o) => o.other && ids.includes(o.id));
      if (otherText && !hasOther) return '`other` is only for the "Other" option.';
      if (!ids.length) return null;
      return hasOther && otherText ? { value: ids, other: otherText } : { value: ids };
    }
  }
}

/**
 * Applies a partial update (`null` clears an answer) to saved answers. Rejects
 * unknown questions, malformed answers and answers to questions that the merged
 * answers hide. Answers that an edit hides are dropped.
 */
export function applyAnswers(
  survey: SurveyDefinition,
  saved: SurveyAnswers,
  patch: Record<string, unknown>,
): { answers: SurveyAnswers } | { problem: AnswerProblem } {
  const merged: SurveyAnswers = { ...saved };
  const answered: string[] = [];
  for (const [id, raw] of Object.entries(patch)) {
    const question = survey.questions.find((q) => q.id === id);
    if (!question) return { problem: { question: id, message: 'That question is not part of your survey.' } };
    const result = normaliseAnswer(question, raw);
    if (typeof result === 'string') return { problem: { question: id, message: result } };
    if (result === null) {
      delete merged[id];
    } else {
      merged[id] = result;
      answered.push(id);
    }
  }
  const visible = new Set(visibleQuestions(survey, merged).map((q) => q.id));
  const hidden = answered.find((id) => !visible.has(id));
  if (hidden) return { problem: { question: hidden, message: 'That question does not apply to your earlier answers.' } };
  return { answers: sanitizeAnswers(survey, merged) };
}
