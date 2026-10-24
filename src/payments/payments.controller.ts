import { BadGatewayException, BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaystackError, PaystackService } from './paystack.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paystack: PaystackService) {}

  /** Nigerian banks with their Paystack codes, for payout account forms. */
  @Get('banks')
  async banks() {
    try {
      return await this.paystack.listBanks();
    } catch (err) {
      if (err instanceof PaystackError) throw new BadGatewayException('Could not load the bank list. Please try again.');
      throw err;
    }
  }

  /** Confirms an account number exists and returns the name on it. */
  @Get('resolve-account')
  @UseGuards(JwtAuthGuard)
  async resolveAccount(@Query('accountNumber') accountNumber = '', @Query('bankCode') bankCode = '') {
    if (!/^\d{10}$/.test(accountNumber)) throw new BadRequestException('Account number must be a 10-digit NUBAN.');
    if (!bankCode.trim()) throw new BadRequestException('Choose a bank first.');
    try {
      return { accountName: await this.paystack.resolveAccount(accountNumber, bankCode.trim()) };
    } catch (err) {
      if (err instanceof PaystackError) {
        throw new BadRequestException('We could not find that account. Check the number and bank.');
      }
      throw err;
    }
  }
}
