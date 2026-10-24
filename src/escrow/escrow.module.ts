import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowTransaction } from './entities/escrow-transaction.entity.js';
import { EscrowService } from './escrow.service.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([EscrowTransaction]), PaymentsModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
