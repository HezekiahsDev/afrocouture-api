import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SurveysService } from './surveys.service.js';
import { UserRole } from '../types/index.js';
import type { User } from '../users/entities/user.entity.js';
import type { SurveyResponse } from './entities/survey-response.entity.js';

const CUSTOMER = { id: 'c1', role: UserRole.CUSTOMER } as User;
const MERCHANT = { id: 'm1', role: UserRole.MERCHANT } as User;

function setup(row: Partial<SurveyResponse> | null = null) {
  const repo = {
    findOne: vi.fn(async () => row as SurveyResponse | null),
    create: vi.fn((data: Partial<SurveyResponse>) => ({ completedAt: null, promptDismissedAt: null, ...data }) as SurveyResponse),
    save: vi.fn(async (r: SurveyResponse) => r),
  };
  return { service: new SurveysService(repo as any), repo };
}

describe('SurveysService', () => {
  it('serves the form for the caller’s role from the database row', async () => {
    const { service, repo } = setup();
    expect((await service.getMine(MERCHANT)).survey.id).toBe('merchant-v1');
    expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 'm1', surveyId: 'merchant-v1' } });
    await expect(service.getMine({ id: 'a1', role: UserRole.ADMIN } as User)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates the response on first save and rejects invalid answers with a code', async () => {
    const { service, repo } = setup();
    await service.saveAnswers(CUSTOMER, { navigation: { value: 'easy' } });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1', surveyId: 'customer-v1', role: 'customer', answers: { navigation: { value: 'easy' } } }));
    const err = await service.saveAnswers(CUSTOMER, { nope: { value: 'x' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'SURVEY_INVALID_ANSWER', question: 'nope' });
  });

  it('refuses to complete with missing answers and lists them', async () => {
    const { service } = setup({ userId: 'c1', surveyId: 'customer-v1', answers: { navigation: { value: 'easy' } }, completedAt: null });
    const err = (await service.complete(CUSTOMER).catch((e: unknown) => e)) as BadRequestException;
    expect(err.getResponse()).toMatchObject({ code: 'SURVEY_INCOMPLETE', missing: expect.arrayContaining(['usage', 'improvements']) });
  });

  it('reopens a submitted form when an edit leaves a required answer blank', async () => {
    const { service } = setup({ userId: 'c1', surveyId: 'customer-v1', answers: { navigation: { value: 'easy' } }, completedAt: new Date() });
    expect((await service.saveAnswers(CUSTOMER, { navigation: null })).completedAt).toBeNull();
  });

  it('records a prompt dismissal once', async () => {
    const { service, repo } = setup();
    expect(await service.dismissPrompt(CUSTOMER)).toMatchObject({ surveyId: 'customer-v1' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ promptDismissedAt: expect.any(Date) }));
  });
});
