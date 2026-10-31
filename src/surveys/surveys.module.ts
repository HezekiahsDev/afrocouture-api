import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurveyResponse } from './entities/survey-response.entity.js';
import { SurveysService } from './surveys.service.js';
import { AdminSurveysService } from './admin-surveys.service.js';
import { SurveysController } from './surveys.controller.js';
import { AdminSurveysController } from './admin-surveys.controller.js';
import { User } from '../users/entities/user.entity.js';
import { AdminAuditLog } from '../admin/audit/admin-audit-log.entity.js';
import { AuditService } from '../admin/audit/audit.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([SurveyResponse, User, AdminAuditLog])],
  controllers: [SurveysController, AdminSurveysController],
  providers: [SurveysService, AdminSurveysService, AuditService],
})
export class SurveysModule {}
