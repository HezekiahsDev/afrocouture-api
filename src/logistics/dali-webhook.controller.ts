import { BadRequestException, Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { DaliLogisticsService, type DaliWebhookEvent } from './dali-logistics.service.js';
import { LogisticsService } from './logistics.service.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * Dali posts delivery updates here. Configure the partner webhook URL in Dali to
 * `https://<api-domain>/logistics/dali/webhook` and use the same whsec_ secret as
 * DALI_LOGISTICS_WEBHOOK_SECRET.
 *
 * Public because Dali has no IPILE account, but every request must carry a valid
 * `X-Dali-Signature` over the exact raw body. Failures return 5xx so Dali retries.
 */
@Public()
@Controller('logistics/dali')
export class DaliWebhookController {
  private readonly logger = new Logger(DaliWebhookController.name);

  constructor(
    private readonly dali: DaliLogisticsService,
    private readonly logistics: LogisticsService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-dali-signature') signature?: string) {
    if (!this.dali.verifyWebhookSignature(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid Dali signature.');
    }
    const body = (req.body ?? {}) as DaliWebhookEvent;
    if (typeof body.id !== 'string' || typeof body.type !== 'string') {
      throw new BadRequestException('Malformed Dali webhook.');
    }

    try {
      const result = await this.logistics.handleWebhook(body);
      return { ...result, received: true };
    } catch (err) {
      // Do not acknowledge: Dali retries with backoff. Duplicate ids are handled in the service.
      this.logger.error(`Could not process Dali webhook ${body.id} (${body.type})`, err as Error);
      throw err;
    }
  }
}
