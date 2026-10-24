import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantProfile } from './entities/merchant-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { MerchantsService } from './merchants.service.js';
import { MerchantsController } from './merchants.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantProfile, User])],
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
