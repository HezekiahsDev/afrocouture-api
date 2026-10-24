import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaystackService } from '../payments/paystack.service.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { OrdersService } from './orders.service.js';

interface PaystackEvent {
  event?: string;
  data?: {
    reference?: string;
    reason?: string;
    gateway_response?: string;
    id?: string | number;
    transaction_reference?: string;
  };
}

/**
 * Paystack notifications. Lives with orders because a successful charge moves an order
 * into escrow; transfer and refund events update the escrow ledger.
 */
@Controller('payments/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly paystack: PaystackService,
    private readonly orders: OrdersService,
    private readonly escrow: EscrowService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') signature?: string) {
    if (!this.paystack.verifySignature(req.rawBody, signature)) throw new UnauthorizedException();

    const { event, data } = (req.body ?? {}) as PaystackEvent;
    try {
      if (event === 'charge.success' && data?.reference) {
        await this.orders.confirmPayment(data.reference);
      } else if (event?.startsWith('transfer.')) {
        await this.escrow.onTransferEvent(event, data?.reference, data?.reason ?? data?.gateway_response);
      } else if (event?.startsWith('refund.')) {
        await this.escrow.onRefundEvent(event, data ?? {});
      }
    } catch (err) {
      // Acknowledge anyway: Paystack retries on non-2xx, and a payment we can't match
      // (e.g. refunded mismatch) shouldn't be redelivered forever. The error is logged.
      this.logger.warn(`Webhook ${event} for ${data?.reference ?? data?.id}: ${(err as Error).message}`);
    }
    return { received: true };
  }
}
