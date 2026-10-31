import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { SurveysService } from './surveys.service.js';
import { SaveSurveyAnswersDto } from './dto/survey.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

/** The testing survey for the caller's role: customers, artisans and merchants each get their own form. */
@Controller('surveys/me')
@Roles(UserRole.CUSTOMER, UserRole.TAILOR, UserRole.MERCHANT)
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get()
  getMine(@CurrentUser() user: User) {
    return this.surveysService.getMine(user);
  }

  @Get('status')
  status(@CurrentUser() user: User) {
    return this.surveysService.status(user);
  }

  @Put('answers')
  saveAnswers(@CurrentUser() user: User, @Body() dto: SaveSurveyAnswersDto) {
    return this.surveysService.saveAnswers(user, dto.answers);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: User) {
    return this.surveysService.complete(user);
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@CurrentUser() user: User) {
    return this.surveysService.dismissPrompt(user);
  }
}
