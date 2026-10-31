import { SURVEYS, surveyForRole } from './definitions/index.js';
import { applyAnswers, missingRequired, sanitizeAnswers, visibleQuestions } from './survey.logic.js';
import { csvCell, answerText } from './admin-surveys.service.js';
import { UserRole } from '../types/index.js';

const customer = surveyForRole(UserRole.CUSTOMER)!;
const merchant = surveyForRole(UserRole.MERCHANT)!;
const tailor = surveyForRole(UserRole.TAILOR)!;
const ids = (questions: { id: string }[]) => questions.map((q) => q.id);

describe('survey definitions', () => {
  it('has one form per member role and none for admins', () => {
    expect(SURVEYS.map((s) => s.role).sort()).toEqual(['customer', 'merchant', 'tailor']);
    expect(surveyForRole(UserRole.ADMIN)).toBeNull();
  });

  it('is internally consistent: unique ids, rules point at earlier choice questions, every language filled in', () => {
    for (const survey of SURVEYS) {
      const seen = new Set<string>();
      for (const q of survey.questions) {
        expect(seen.has(q.id), `${survey.id}.${q.id} duplicated`).toBe(false);
        for (const text of [q.prompt, ...(q.options ?? []).map((o) => o.label)]) {
          for (const lang of ['en', 'ha', 'yo', 'ig'] as const) expect(text[lang].trim(), `${survey.id}.${q.id} ${lang}`).not.toBe('');
        }
        if (q.showIf) {
          expect(seen.has(q.showIf.question), `${survey.id}.${q.id} rule must point back`).toBe(true);
          const target = survey.questions.find((t) => t.id === q.showIf!.question)!;
          for (const id of [...(q.showIf.anyOf ?? []), ...(q.showIf.noneOf ?? [])]) {
            expect(target.options?.some((o) => o.id === id), `${survey.id}.${q.id} → ${id}`).toBe(true);
          }
        }
        seen.add(q.id);
      }
    }
  });
});

describe('branching', () => {
  it('asks customers about the custom-order flow only when they want a tailor', () => {
    expect(ids(visibleQuestions(customer, {}))).not.toContain('custom_order_flow');
    expect(ids(visibleQuestions(customer, { usage: { value: 'fabrics' } }))).not.toContain('custom_order_flow');
    expect(ids(visibleQuestions(customer, { usage: { value: 'find_tailor' } }))).toContain('custom_order_flow');
    expect(ids(visibleQuestions(customer, { usage: { value: 'multiple' } }))).toContain('custom_order_flow');
  });

  it('asks for problem details only after "yes"', () => {
    expect(ids(visibleQuestions(customer, { had_problem: { value: 'no' } }))).not.toContain('problem_details');
    expect(ids(visibleQuestions(customer, { had_problem: { value: 'yes' } }))).toContain('problem_details');
  });

  it('shows friction follow-ups unless the answer was the most positive one', () => {
    expect(ids(visibleQuestions(merchant, {}))).not.toContain('discovery_improvements');
    expect(ids(visibleQuestions(merchant, { discovery_confidence: { value: 'very' } }))).not.toContain('discovery_improvements');
    expect(ids(visibleQuestions(merchant, { discovery_confidence: { value: 'not' } }))).toContain('discovery_improvements');
    expect(ids(visibleQuestions(tailor, { fabric_handover: { value: 'easy' } }))).not.toContain('handover_improvements');
    expect(ids(visibleQuestions(tailor, { fabric_handover: { value: 'difficult' } }))).toContain('handover_improvements');
    expect(ids(visibleQuestions(tailor, { payment_split: { value: 'needs_changes' } }))).toContain('payment_alternative');
  });

  it('drops answers to questions an edit has hidden', () => {
    const answers = { usage: { value: 'fabrics' }, custom_order_flow: { value: 'yes' } };
    expect(sanitizeAnswers(customer, answers)).toEqual({ usage: { value: 'fabrics' } });
  });
});

describe('applyAnswers', () => {
  it('merges, trims and clears with null', () => {
    const first = applyAnswers(customer, {}, { navigation: { value: 'easy' }, improvements: { value: [' Faster pages ', '', ''] } });
    expect(first).toEqual({ answers: { navigation: { value: 'easy' }, improvements: { value: ['Faster pages', '', ''] } } });
    const cleared = applyAnswers(customer, (first as { answers: any }).answers, { navigation: null });
    expect(cleared).toEqual({ answers: { improvements: { value: ['Faster pages', '', ''] } } });
  });

  it('rejects questions from another role’s form', () => {
    expect(applyAnswers(customer, {}, { listing_info: { value: ['material'] } })).toMatchObject({ problem: { question: 'listing_info' } });
  });

  it('rejects answers to hidden questions, even in the same request as the parent', () => {
    expect(applyAnswers(customer, {}, { custom_order_flow: { value: 'yes' } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { usage: { value: 'fabrics' }, custom_order_flow: { value: 'yes' } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { usage: { value: 'find_tailor' }, custom_order_flow: { value: 'yes' } })).toHaveProperty('answers');
  });

  it('checks option ids, single vs multi, exclusive options and "other" text', () => {
    expect(applyAnswers(customer, {}, { navigation: { value: 'great' } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { navigation: { value: ['easy'] } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { hesitations: { value: ['nothing', 'scam'] } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { trust_info: { value: ['reviews'], other: 'x' } })).toHaveProperty('problem');
    expect(applyAnswers(customer, {}, { trust_info: { value: ['reviews', 'other'], other: ' Location ' } })).toEqual({
      answers: { trust_info: { value: ['reviews', 'other'], other: 'Location' } },
    });
    expect(applyAnswers(customer, {}, { had_problem: { value: 'yes' }, problem_details: { value: 'x'.repeat(2001) } })).toHaveProperty('problem');
  });
});

describe('missingRequired', () => {
  it('counts only visible required questions and needs "other" text when Other is picked', () => {
    const answers = {
      navigation: { value: 'easy' },
      usage: { value: 'fabrics' },
      discovery: { value: 'easy' },
      trust_info: { value: ['other'] },
      hesitations: { value: ['nothing'] },
      escrow_comfort: { value: 'very' },
      ordering_clarity: { value: 'very_clear' },
      had_problem: { value: 'no' },
      improvements: { value: ['Cheaper delivery', '', ''] },
    };
    expect(missingRequired(customer, answers)).toEqual(['trust_info']);
    expect(missingRequired(customer, { ...answers, trust_info: { value: ['other'], other: 'Location' } })).toEqual([]);
    expect(missingRequired(customer, { ...answers, usage: { value: 'find_tailor' } })).toContain('custom_order_flow');
  });
});

describe('CSV', () => {
  it('quotes cells and neutralises spreadsheet formulas', () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
  });

  it('writes English option labels and "Other" text', () => {
    const trust = customer.questions.find((q) => q.id === 'trust_info')!;
    expect(answerText(trust, { value: ['reviews', 'other'], other: 'Location' })).toBe('Customer reviews and ratings; Other: Location');
  });
});
