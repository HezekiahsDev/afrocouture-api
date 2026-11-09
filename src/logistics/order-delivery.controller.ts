import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { LogisticsService } from './logistics.service.js';
import { CancelDeliveryDto, CreateDeliveryDto, QuoteDeliveryDto } from './dto/delivery.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RateLimit } from '../common/rate-limit/rate-limit.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

/**
 * Rider delivery for one order. The artisan books at the handover stage; the customer
 * follows the rider and gets the handover PIN. Admins can see everything.
 */
@Controller('orders/:id/delivery')
export class OrderDeliveryController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.getForOrder(user, id);
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR, UserRole.ADMIN)
  @RateLimit({ name: 'dali-quote', limit: 60, windowSec: 60, by: ['user'] })
  quote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDeliveryDto) {
    return this.logistics.quoteForOrder(user, id, dto);
  }

  @Post()
  @Roles(UserRole.TAILOR, UserRole.ADMIN)
  @RateLimit({ name: 'dali-book', limit: 20, windowSec: 60 * 60, by: ['user'] })
  book(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDeliveryDto) {
    return this.logistics.bookForOrder(user, id, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR, UserRole.ADMIN)
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    return this.logistics.cancelForOrder(user, id, dto.reason);
  }
}
