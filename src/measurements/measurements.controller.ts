import { Body, Controller, Get, Put } from '@nestjs/common';
import { MeasurementsService } from './measurements.service.js';
import { SaveMeasurementsDto } from './dto/save-measurements.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../types/index.js';

/** A customer's own fit profile; artisans see a snapshot of it on each order instead. */
@Controller('measurements/me')
@Roles(UserRole.CUSTOMER)
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
