import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ReviewDecisionDto } from '../common/dto/review.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { KycStatus, UserRole } from '../types/index.js';
import { User } from '../users/entities/user.entity.js';
import { TailorsService } from '../tailors/tailors.service.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { OrderStatus } from '../orders/entities/order.entity.js';
import { HideReviewDto, ListReviewsQuery, ResolveDisputeDto } from '../orders/dto/order.dto.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { EscrowTransactionStatus } from '../escrow/entities/escrow-transaction.entity.js';
import { ChatService } from '../chat/chat.service.js';
import { AuditService } from './audit/audit.service.js';
import { AdminOverviewService } from './admin-overview.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminFabricsService } from './admin-fabrics.service.js';
import {
  AdminMessagesQuery,
  ListAdminFabricsQuery,
  ListAdminOrdersQuery,
  ListAuditQuery,
  ListUsersQuery,
  ModerateFabricDto,
  SuspendUserDto,
} from './dto/admin.dto.js';

const ORDER_STATUSES = Object.values(OrderStatus) as string[];

/**
 * The admin console: overview, verification queue, users, orders and disputes, payouts,
 * review and fabric moderation, and the audit log of admin actions.
 * Admin accounts are created with `pnpm admin:create`.
 */
@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly tailors: TailorsService,
    private readonly merchants: MerchantsService,
    private readonly orders: OrdersService,
    private readonly escrow: EscrowService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    private readonly overviewService: AdminOverviewService,
    private readonly users: AdminUsersService,
    private readonly fabrics: AdminFabricsService,
  ) {}

  @Get('overview')
  overview() {
    return this.overviewService.overview();
  }

  // ── Verification ──

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
  async reviewTailor(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    const profile = await this.tailors.review(id, dto);
    const name = profile.atelierName ?? profile.displayName ?? 'artisan';
    await this.audit.record(admin, {
      action: dto.decision === 'approve' ? 'verification.approve' : 'verification.reject',
      targetType: 'tailor',
      targetId: id,
      summary: `${dto.decision === 'approve' ? 'Approved' : 'Rejected'} artisan ${name}`,
      details: { note: profile.reviewNote },
    });
    return profile;
  }

  @Patch('merchants/:id/review')
  async reviewMerchant(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    const profile = await this.merchants.review(id, dto);
    await this.audit.record(admin, {
      action: dto.decision === 'approve' ? 'verification.approve' : 'verification.reject',
      targetType: 'merchant',
      targetId: id,
      summary: `${dto.decision === 'approve' ? 'Approved' : 'Rejected'} merchant ${profile.businessName ?? ''}`.trim(),
      details: { note: profile.reviewNote },
    });
    return profile;
  }

  // ── Users ──

  @Get('users')
  listUsers(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendUserDto) {
    const user = await this.users.suspend(admin, id, dto.reason);
    await this.audit.record(admin, {
      action: 'user.suspend',
      targetType: 'user',
      targetId: id,
      summary: `Suspended ${user.email}`,
      details: { reason: dto.reason.trim() },
    });
    return user;
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.users.reactivate(admin, id);
    await this.audit.record(admin, { action: 'user.reactivate', targetType: 'user', targetId: id, summary: `Reactivated ${user.email}` });
    return user;
  }

  // ── Orders & disputes ──

  @Get('orders')
  listOrders(@Query() query: ListAdminOrdersQuery) {
    const statuses = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = statuses.filter((s) => !ORDER_STATUSES.includes(s));
    if (unknown.length) throw new BadRequestException(`Unknown order status: ${unknown.join(', ')}`);
    return this.orders.listForAdmin({ statuses: statuses as OrderStatus[], q: query.q, page: query.page, limit: query.limit });
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  @Get('orders/:id/messages')
  orderMessages(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminMessagesQuery) {
    return this.chat.listForAdmin(id, query);
  }

  @Post('orders/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto) {
    const order = await this.orders.resolveDispute(admin, id, dto);
    const refunded = 'escrow' in order && order.escrow ? order.escrow.refunded : undefined;
    await this.audit.record(admin, {
      action: 'dispute.resolve',
      targetType: 'order',
      targetId: id,
      summary: `Resolved dispute on ${order.reference}: ${dto.outcome === 'release' ? 'released to the artisan' : 'refund to the customer'}`,
      details: { outcome: dto.outcome, refundAmount: dto.outcome === 'refund' ? (dto.refundAmount ?? refunded ?? null) : null, note: dto.note },
    });
    return order;
  }

  // ── Escrow ──

  @Get('escrow')
  listEscrow(@Query('status', new DefaultValuePipe(EscrowTransactionStatus.FAILED)) status: string) {
    if (status !== 'all' && !(Object.values(EscrowTransactionStatus) as string[]).includes(status)) {
      throw new BadRequestException(`Unknown escrow status: ${status}`);
    }
    return this.orders.escrowQueue(status as EscrowTransactionStatus | 'all');
  }

  @Post('escrow/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const tx = await this.escrow.retry(id);
    await this.audit.record(admin, {
      action: 'payout.retry',
      targetType: 'escrow_transaction',
      targetId: id,
      summary: `Retried ${tx.type.replace('_', ' ')} of ₦${tx.amount.toLocaleString('en-NG')}`,
      details: { orderId: tx.orderId, amount: tx.amount, status: tx.status },
    });
    return tx;
  }

  // ── Reviews ──

  @Get('reviews')
  listReviews(@Query() query: ListReviewsQuery) {
    return this.orders.listReviewsForAdmin(query);
  }

  @Patch('reviews/:orderId')
  async hideReview(@CurrentUser() admin: User, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: HideReviewDto) {
    const result = await this.orders.setReviewHidden(orderId, dto.hidden);
    await this.audit.record(admin, {
      action: dto.hidden ? 'review.hide' : 'review.unhide',
      targetType: 'review',
      targetId: orderId,
      summary: `${dto.hidden ? 'Hid' : 'Restored'} the review on order ${orderId.slice(0, 8)}`,
    });
    return result;
  }

  // ── Fabrics ──

  @Get('fabrics')
  listFabrics(@Query() query: ListAdminFabricsQuery) {
    return this.fabrics.list(query);
  }

  @Patch('fabrics/:id')
  async moderateFabric(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateFabricDto) {
    const { fabric, changed } = await this.fabrics.moderate(id, dto);
    if (changed) {
      await this.audit.record(admin, {
        action: dto.isPublished ? 'fabric.publish' : 'fabric.unpublish',
        targetType: 'fabric',
        targetId: id,
        summary: `${dto.isPublished ? 'Published' : 'Unpublished'} “${fabric.name}” (${fabric.merchant.businessName ?? 'merchant'})`,
        details: dto.isPublished ? null : { note: fabric.unpublishedReason },
      });
    }
    return fabric;
  }

  // ── Audit ──

  @Get('audit')
  listAudit(@Query() query: ListAuditQuery) {
    return this.audit.list(query);
  }
}
