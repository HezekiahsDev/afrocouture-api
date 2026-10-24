import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerFitProfile } from './entities/customer-fit-profile.entity.js';
import { MeasurementsService } from './measurements.service.js';
import { MeasurementsController } from './measurements.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerFitProfile])],
  controllers: [MeasurementsController],
  providers: [MeasurementsService],
  exports: [MeasurementsService],
})
export class MeasurementsModule {}
