import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository, type FindOptionsWhere } from 'typeorm';
import { SurveyResponse } from './entities/survey-response.entity.js';
import { SURVEYS, surveyById, type SurveyAnswer, type SurveyDefinition, type SurveyQuestion } from './definitions/index.js';
import { isAnswered, visibleQuestions } from './survey.logic.js';
import type { ListSurveyResponsesQuery } from './dto/survey.dto.js';
import { User } from '../users/entities/user.entity.js';
import { AuditService } from '../admin/audit/audit.service.js';

type UserSummary = { id: string; fullName: string | null; email: string } | null;

/** Admin view of survey results: counts, option tallies, individual responses and CSV export. */
@Injectable()
export class AdminSurveysService {
  constructor(
    @InjectRepository(SurveyResponse) private readonly responses: Repository<SurveyResponse>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  private require(surveyId: string): SurveyDefinition {
    const survey = surveyById(surveyId);
    if (!survey) throw new NotFoundException('Survey not found.');
    return survey;
  }

  async list() {
    const rows = await this.responses
      .createQueryBuilder('r')
      .select('"r"."surveyId"', 'surveyId')
      .addSelect('COUNT(*) FILTER (WHERE "r"."completedAt" IS NOT NULL)', 'completed')
      .addSelect(`COUNT(*) FILTER (WHERE "r"."completedAt" IS NULL AND "r"."answers" <> '{}'::jsonb)`, 'inProgress')
      .groupBy('"r"."surveyId"')
      .getRawMany<{ surveyId: string; completed: string; inProgress: string }>();
    return SURVEYS.map((survey) => {
      const row = rows.find((r) => r.surveyId === survey.id);
      return {
        id: survey.id,
        role: survey.role,
        title: survey.title,
        questionCount: survey.questions.length,
        completed: Number(row?.completed ?? 0),
        inProgress: Number(row?.inProgress ?? 0),
      };
    });
  }

  /** The definition (for previews) plus how often each option was picked in submitted responses. */
  async summary(surveyId: string) {
    const survey = this.require(surveyId);
    const completed = await this.responses.find({
      where: { surveyId, completedAt: Not(IsNull()) },
      select: { id: true, answers: true },
    });
    const tallies: Record<string, { answered: number; options: Record<string, number> }> = {};
    for (const question of survey.questions) {
      if (question.kind !== 'single' && question.kind !== 'multi') continue;
      const options = Object.fromEntries(question.options!.map((o) => [o.id, 0]));
      let answered = 0;
      for (const { answers } of completed) {
        const answer = answers[question.id];
        if (!answer) continue;
        answered++;
        for (const id of Array.isArray(answer.value) ? answer.value : [answer.value]) {
          if (id in options) options[id]++;
        }
      }
      tallies[question.id] = { answered, options };
    }
    return { survey, completed: completed.length, tallies };
  }

  private async usersById(ids: string[]): Promise<Map<string, UserSummary>> {
    if (!ids.length) return new Map();
    const users = await this.users.find({ where: { id: In(ids) }, select: { id: true, fullName: true, email: true } });
    return new Map(users.map((u) => [u.id, { id: u.id, fullName: u.fullName ?? null, email: u.email }]));
  }

  private progress(survey: SurveyDefinition, response: SurveyResponse) {
    const visible = visibleQuestions(survey, response.answers);
    return {
      answered: visible.filter((q) => isAnswered(q, response.answers[q.id])).length,
      total: visible.length,
    };
  }

  async responsesFor(surveyId: string, query: ListSurveyResponsesQuery) {
    const survey = this.require(surveyId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: FindOptionsWhere<SurveyResponse> = { surveyId };
    if (query.status === 'completed') where.completedAt = Not(IsNull());
    if (query.status === 'in_progress') where.completedAt = IsNull();
    const [rows, total] = await this.responses.findAndCount({
      where,
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const users = await this.usersById(rows.map((r) => r.userId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: users.get(r.userId) ?? null,
        role: r.role,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        ...this.progress(survey, r),
      })),
      total,
      page,
      limit,
    };
  }

  async response(id: string) {
    const response = await this.responses.findOne({ where: { id } });
    if (!response) throw new NotFoundException('Response not found.');
    const survey = this.require(response.surveyId);
    const users = await this.usersById([response.userId]);
    return {
      id: response.id,
      surveyId: response.surveyId,
      user: users.get(response.userId) ?? null,
      role: response.role,
      answers: response.answers,
      completedAt: response.completedAt,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      ...this.progress(survey, response),
    };
  }

  /** Every response with any answers, one row each, one column per question (English labels). */
  async exportCsv(admin: Pick<User, 'id'>, surveyId: string) {
    const survey = this.require(surveyId);
    const rows = (await this.responses.find({ where: { surveyId }, order: { createdAt: 'ASC' } })).filter(
      (r) => Object.keys(r.answers).length > 0,
    );
    const users = await this.usersById(rows.map((r) => r.userId));
    const header = [
      'Response ID',
      'Name',
      'Email',
      'Role',
      'Status',
      'Started',
      'Submitted',
      ...survey.questions.map((q) => `${q.id}: ${q.prompt.en}`),
    ];
    const lines = rows.map((r) => {
      const user = users.get(r.userId);
      return [
        r.id,
        user?.fullName ?? '',
        user?.email ?? '',
        r.role,
        r.completedAt ? 'Submitted' : 'In progress',
        r.createdAt.toISOString(),
        r.completedAt?.toISOString() ?? '',
        ...survey.questions.map((q) => answerText(q, r.answers[q.id])),
      ];
    });
    const csv = [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n');

    await this.audit.record(admin, {
      action: 'survey.export',
      targetType: 'survey',
      targetId: survey.id,
      summary: `Exported ${rows.length} ${survey.id} responses`,
    });
    // BOM so spreadsheet apps read the UTF-8 names and Hausa/Yoruba/Igbo text correctly.
    return { filename: `ipile-${survey.id}-responses.csv`, content: `﻿${csv}` };
  }
}

/** A readable cell for one answer: option labels, "Other: …" text, or the typed text. */
export function answerText(question: SurveyQuestion, answer: SurveyAnswer | undefined): string {
  if (!answer) return '';
  if (question.kind === 'text') return String(answer.value);
  if (question.kind === 'list') return (answer.value as string[]).filter(Boolean).join('; ');
  const ids = Array.isArray(answer.value) ? answer.value : [answer.value];
  return ids
    .map((id) => {
      const option = question.options?.find((o) => o.id === id);
      if (!option) return id;
      return option.other && answer.other ? `${option.label.en}: ${answer.other}` : option.label.en;
    })
    .join('; ');
}

/**
 * Quotes a CSV cell. A leading = + - @ (or tab/CR) would run as a formula in
 * spreadsheet apps, so such cells are prefixed with an apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
