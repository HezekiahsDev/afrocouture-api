import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ReviewDecisionDto } from '../common/dto/review.dto.js';
import { KycStatus, UserRole } from '../types/index.js';
import { TailorsModule } from '../tailors/tailors.module.js';
import { TailorsService } from '../tailors/tailors.service.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { OrdersService } from '../orders/orders.service.js';
import { OrderStatus } from '../orders/entities/order.entity.js';
import { ResolveDisputeDto } from '../orders/dto/order.dto.js';
import { EscrowModule } from '../escrow/escrow.module.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { EscrowTransactionStatus } from '../escrow/entities/escrow-transaction.entity.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';

/**
 * Verification queue for artisans and merchants, dispute resolution and payout recovery.
 * Admin accounts are created with `pnpm admin:create`.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly tailors: TailorsService,
    private readonly merchants: MerchantsService,
    private readonly orders: OrdersService,
    private readonly escrow: EscrowService,
  ) {}

  @Get('verifications')
  async verifications(
    @Query('status', new DefaultValuePipe(KycStatus.PENDING), new ParseEnumPipe(KycStatus)) status: KycStatus,
  ) {
    const [tailors, merchants] = await Promise.all([
      this.tailors.listForReview(status),
      this.merchants.listForReview(status),
    ]);
    return { tailors, merchants };
  }

  @Patch('tailors/:id/review')
  reviewTailor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    return this.tailors.review(id, dto);
  }

  @Patch('merchants/:id/review')
  reviewMerchant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    return this.merchants.review(id, dto);
  }

  // ── Orders & escrow ──

  @Get('orders')
  listOrders(
    @Query('status', new DefaultValuePipe(OrderStatus.DISPUTED), new ParseEnumPipe(OrderStatus)) status: OrderStatus,
  ) {
    return this.orders.listForAdmin(status);
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  @Post('orders/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto) {
    return this.orders.resolveDispute(user, id, dto);
  }

  @Get('escrow')
  listEscrow(
    @Query('status', new DefaultValuePipe(EscrowTransactionStatus.FAILED), new ParseEnumPipe(EscrowTransactionStatus))
    status: EscrowTransactionStatus,
  ) {
    return this.orders.escrowQueue(status);
  }

  @Post('escrow/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrow.retry(id);
  }
}

@Module({
  imports: [TailorsModule, MerchantsModule, OrdersModule, EscrowModule],
  controllers: [AdminController],
})
export class AdminModule {}
