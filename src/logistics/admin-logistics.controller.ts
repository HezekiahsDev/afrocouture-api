import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { LogisticsService } from './logistics.service.js';
import { AdminListDeliveriesQuery, SimulateDeliveryDto } from './dto/delivery.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../types/index.js';
import { Param, ParseUUIDPipe } from '@nestjs/common';

/** Rider delivery operations for the admin console. */
@Controller('admin/logistics')
@Roles(UserRole.ADMIN)
export class AdminLogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  /** Dali account status, scopes, balance and webhook URL (read live from Dali). */
  @Get('account')
  account() {
    return this.logistics.account();
  }

  /** Every rider job across orders, newest first. */
  @Get()
  list(@Query() query: AdminListDeliveriesQuery) {
    return this.logistics.listForAdmin(query);
  }

  /** Sends Dali's signed `ping` to the webhook we have configured, to check the setup. */
  @Post('webhooks/test')
  @HttpCode(HttpStatus.OK)
  testWebhook() {
    return this.logistics.testWebhook();
  }

  /** Test keys only: move a simulated job forward (Dali refuses on live keys). */
  @Post(':deliveryId/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@Param('deliveryId', ParseUUIDPipe) deliveryId: string, @Body() dto: SimulateDeliveryDto) {
    return this.logistics.simulateForAdmin(deliveryId, dto.status);
  }
}
