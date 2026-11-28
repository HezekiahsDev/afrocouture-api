import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { verifySignature } from '../payments/stellar/webhook-signature.js';
import { StellarWebhookReceipt } from '../payments/stellar/entities/stellar-webhook-receipt.entity.js';
import { ServiceEvent, StellarCheckoutService } from './stellar-checkout.service.js';

/**
 * Events from stellar-payment-service. Every request must carry a valid `x-stellar-signature`
 * (HMAC-SHA256 with STELLAR_WEBHOOK_SECRET over `${t}.${raw body}`, at most 5 minutes old).
 * Delivery is at least once: handling is idempotent and each event id is recorded once handled.
 * A non-2xx answer makes the service retry with backoff.
 */
@Public()
@Controller('payments/stellar')
export class StellarWebhookController {
  private readonly logger = new Logger(StellarWebhookController.name);
  private readonly secret: string | null;

  constructor(
    config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly checkout: StellarCheckoutService,
  ) {
    this.secret = config.get<string>('STELLAR_WEBHOOK_SECRET')?.trim() || null;
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-stellar-signature') signature?: string) {
    if (!this.secret) throw new ServiceUnavailableException('Stellar webhooks are not configured.');
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!verifySignature(this.secret, raw, signature)) throw new UnauthorizedException();

    const event = JSON.parse(raw) as ServiceEvent;
    const receipts = this.dataSource.getRepository(StellarWebhookReceipt);
    if (await receipts.existsBy({ id: event.id })) return { received: true, duplicate: true };

    await this.checkout.handleEvent(event); // throws → 500 → the service retries
    await receipts.createQueryBuilder().insert().values({ id: event.id, type: event.type }).orIgnore().execute();
    this.logger.log(`Stellar event ${event.type} ${event.id} handled`);
    return { received: true };
  }
}
