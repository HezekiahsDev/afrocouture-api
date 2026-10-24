import { Module } from '@nestjs/common';
import { PaystackService } from './paystack.service.js';
import { PaymentsController } from './payments.controller.js';

@Module({
  controllers: [PaymentsController],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaymentsModule {}
