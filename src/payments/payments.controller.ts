import { BadGatewayException, BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PaystackError, PaystackService } from './paystack.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RateLimit } from '../common/rate-limit/rate-limit.js';
import { UserRole } from '../types/index.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paystack: PaystackService) {}

  /** Nigerian banks with their Paystack codes, for payout account forms. */
  @Public()
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
  @Roles(UserRole.TAILOR, UserRole.MERCHANT)
  // Only payout forms need this; limited so it can't be used to look up strangers' account names.
  @RateLimit({ name: 'resolve-account', limit: 20, windowSec: 60 * 60, by: ['user'] })
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
