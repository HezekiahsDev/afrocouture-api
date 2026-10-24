import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TailorProfile } from './entities/tailor-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { TailorsService } from './tailors.service.js';
import { TailorsController } from './tailors.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([TailorProfile, User])],
  controllers: [TailorsController],
  providers: [TailorsService],
  exports: [TailorsService],
})
export class TailorsModule {}
