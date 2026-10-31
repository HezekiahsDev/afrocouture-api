import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SurveyResponse } from './entities/survey-response.entity.js';
import { surveyForRole, type SurveyDefinition } from './definitions/index.js';
import { applyAnswers, isAnswered, missingRequired, visibleQuestions } from './survey.logic.js';
import { User } from '../users/entities/user.entity.js';

/** A signed-in member's own survey. The form always comes from their current role in the database. */
@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(SurveyResponse)
    private readonly responses: Repository<SurveyResponse>,
  ) {}

  private surveyFor(user: User): SurveyDefinition {
    const survey = surveyForRole(user.role);
    if (!survey) throw new ForbiddenException({ code: 'NO_SURVEY', message: 'There is no survey for your account.' });
    return survey;
  }

  private findMine(user: User, survey: SurveyDefinition): Promise<SurveyResponse | null> {
    return this.responses.findOne({ where: { userId: user.id, surveyId: survey.id } });
  }

  private toMine(response: SurveyResponse) {
    return {
      answers: response.answers,
      completedAt: response.completedAt,
      updatedAt: response.updatedAt,
    };
  }

  async getMine(user: User) {
    const survey = this.surveyFor(user);
    const response = await this.findMine(user, survey);
    return { survey, response: response ? this.toMine(response) : null };
  }

  /** Small enough for the navbar prompt to call on every page. */
  async status(user: User) {
    const survey = this.surveyFor(user);
    const response = await this.findMine(user, survey);
    const answers = response?.answers ?? {};
    const visible = visibleQuestions(survey, answers);
    return {
      surveyId: survey.id,
      completed: Boolean(response?.completedAt),
      dismissed: Boolean(response?.promptDismissedAt),
      answered: visible.filter((q) => isAnswered(q, answers[q.id])).length,
      total: visible.length,
    };
  }

  async saveAnswers(user: User, patch: Record<string, unknown>) {
    const survey = this.surveyFor(user);
    if (Object.keys(patch).length > survey.questions.length) {
      throw new BadRequestException({ code: 'SURVEY_INVALID_ANSWER', message: 'Too many answers.' });
    }
    const response =
      (await this.findMine(user, survey)) ??
      this.responses.create({ userId: user.id, surveyId: survey.id, role: user.role, answers: {} });
    const result = applyAnswers(survey, response.answers, patch);
    if ('problem' in result) {
      throw new BadRequestException({ code: 'SURVEY_INVALID_ANSWER', ...result.problem });
    }
    response.answers = result.answers;
    response.role = user.role;
    // An edit that leaves a required question blank reopens a submitted form.
    if (response.completedAt && missingRequired(survey, response.answers).length) response.completedAt = null;
    return this.toMine(await this.responses.save(response));
  }

  async complete(user: User) {
    const survey = this.surveyFor(user);
    const response = await this.findMine(user, survey);
    const missing = missingRequired(survey, response?.answers ?? {});
    if (!response || missing.length) {
      throw new BadRequestException({
        code: 'SURVEY_INCOMPLETE',
        message: 'Answer the remaining questions before submitting.',
        missing,
      });
    }
    response.completedAt ??= new Date();
    return this.toMine(await this.responses.save(response));
  }

  async dismissPrompt(user: User) {
    const survey = this.surveyFor(user);
    const response =
      (await this.findMine(user, survey)) ??
      this.responses.create({ userId: user.id, surveyId: survey.id, role: user.role, answers: {} });
    response.promptDismissedAt ??= new Date();
    await this.responses.save(response);
    return this.status(user);
  }
}
