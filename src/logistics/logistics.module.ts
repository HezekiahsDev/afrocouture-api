import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module.js';
import { LogisticsDelivery, LogisticsWebhookEvent } from './entities/logistics-delivery.entity.js';
import { DaliLogisticsService } from './dali-logistics.service.js';
import { LogisticsService } from './logistics.service.js';
import { OrderDeliveryController } from './order-delivery.controller.js';
import { DaliWebhookController } from './dali-webhook.controller.js';
import { AdminLogisticsController } from './admin-logistics.controller.js';

/**
 * Dali Logistics partner integration: rider quotes, booking at handover, live status
 * webhooks and admin oversight. Credentials live in DALI_LOGISTICS_* server env vars.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LogisticsDelivery, LogisticsWebhookEvent]), OrdersModule],
  controllers: [OrderDeliveryController, DaliWebhookController, AdminLogisticsController],
  providers: [DaliLogisticsService, LogisticsService],
  exports: [DaliLogisticsService, LogisticsService],
})
export class LogisticsModule {}
