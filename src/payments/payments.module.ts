import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaystackService } from './paystack.service.js';
import { PaymentsController } from './payments.controller.js';
import { StellarPaymentsClient } from './stellar/stellar-payments.client.js';
import { StellarWebhookReceipt } from './stellar/entities/stellar-webhook-receipt.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([StellarWebhookReceipt])],
  controllers: [PaymentsController],
  providers: [PaystackService, StellarPaymentsClient],
  exports: [PaystackService, StellarPaymentsClient, TypeOrmModule],
})
export class PaymentsModule {}
