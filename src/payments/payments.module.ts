import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaystackService } from './paystack.service.js';
import { PaymentsController } from './payments.controller.js';
import { StellarService } from './stellar/stellar.service.js';
import { FxRateService } from './stellar/fx-rate.service.js';
import { StellarCursor } from './stellar/entities/stellar-cursor.entity.js';
import { StellarUnmatchedDeposit } from './stellar/entities/stellar-unmatched-deposit.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([StellarCursor, StellarUnmatchedDeposit])],
  controllers: [PaymentsController],
  providers: [PaystackService, StellarService, FxRateService],
  exports: [PaystackService, StellarService, FxRateService, TypeOrmModule],
})
export class PaymentsModule {}
