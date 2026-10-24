import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { MeasurementsService } from './measurements.service.js';
import { SaveMeasurementsDto } from './dto/save-measurements.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';

@Controller('measurements/me')
@UseGuards(JwtAuthGuard)
export class MeasurementsController {
  constructor(private readonly measurementsService: MeasurementsService) {}

  @Get()
  getMine(@CurrentUser() user: User) {
    return this.measurementsService.findMine(user);
  }

  @Put()
  saveMine(@CurrentUser() user: User, @Body() dto: SaveMeasurementsDto) {
    return this.measurementsService.saveMine(user, dto);
  }
}
