import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderEvent } from './entities/order-event.entity.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { PaystackWebhookController } from './paystack-webhook.controller.js';
import { EscrowModule } from '../escrow/escrow.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { Fabric } from '../fabrics/entities/fabric.entity.js';
import { CustomerFitProfile } from '../measurements/entities/customer-fit-profile.entity.js';
import { SavedItem } from '../saved-items/entities/saved-item.entity.js';
import { AiDesign } from '../ai-studio/entities/ai-design.entity.js';
import { Style } from '../styles/entities/style.entity.js';
import { User } from '../users/entities/user.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderEvent,
      TailorProfile,
      MerchantProfile,
      Fabric,
      CustomerFitProfile,
      SavedItem,
      AiDesign,
      Style,
      User,
    ]),
    EscrowModule,
    PaymentsModule,
  ],
  controllers: [OrdersController, PaystackWebhookController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
