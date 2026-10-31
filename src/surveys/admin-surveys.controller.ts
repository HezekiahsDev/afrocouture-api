import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { AdminSurveysService } from './admin-surveys.service.js';
import { ListSurveyResponsesQuery } from './dto/survey.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

/** Survey results for admins. Responses are read-only; exports are audit-logged. */
@Controller('admin/surveys')
@Roles(UserRole.ADMIN)
export class AdminSurveysController {
  constructor(private readonly adminSurveysService: AdminSurveysService) {}

  @Get()
  list() {
    return this.adminSurveysService.list();
  }

  // Declared before `:surveyId` so "responses" is not read as a survey id.
  @Get('responses/:id')
  response(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminSurveysService.response(id);
  }

  @Get(':surveyId')
  summary(@Param('surveyId') surveyId: string) {
    return this.adminSurveysService.summary(surveyId);
  }

  @Get(':surveyId/responses')
  responses(@Param('surveyId') surveyId: string, @Query() query: ListSurveyResponsesQuery) {
    return this.adminSurveysService.responsesFor(surveyId, query);
  }

  @Get(':surveyId/export.csv')
  async export(@CurrentUser() admin: User, @Param('surveyId') surveyId: string) {
    const { filename, content } = await this.adminSurveysService.exportCsv(admin, surveyId);
    return new StreamableFile(Buffer.from(content, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
