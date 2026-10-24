import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fabric } from './entities/fabric.entity.js';
import { FabricsService } from './fabrics.service.js';
import { FabricsController } from './fabrics.controller.js';
import { MerchantsModule } from '../merchants/merchants.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Fabric]), MerchantsModule],
  controllers: [FabricsController],
  providers: [FabricsService],
  exports: [FabricsService],
})
export class FabricsModule {}
