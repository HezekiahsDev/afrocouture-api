import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import {
  ApproveDto,
  CreateOrderDto,
  ListOrdersQuery,
  ListReviewsQuery,
  MilestoneDto,
  NoteDto,
  QuoteDto,
  ReasonDto,
  ReviewDto,
  ReviewReplyDto,
  VerifyPaymentDto,
} from './dto/order.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListOrdersQuery) {
    return this.orders.list(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  // ── Tailor ──

  @Post(':id/quote')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  quote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDto) {
    return this.orders.quote(user, id, dto);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  decline(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.decline(user, id, dto);
  }

  @Post(':id/milestone')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  milestone(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneDto) {
    return this.orders.advanceMilestone(user, id, dto);
  }

  @Post(':id/items/:itemId/receive')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  receive(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.orders.receiveItem(user, id, itemId);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  deliver(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.orders.deliver(user, id, dto);
  }

  // ── Merchant ──

  @Post(':id/items/:itemId/ship')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.MERCHANT)
  ship(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: NoteDto,
  ) {
    return this.orders.shipItem(user, id, itemId, dto);
  }

  // ── Customer ──

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user, id);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  pay(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.pay(user, id);
  }

  @Post(':id/verify-payment')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  verifyPayment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPaymentDto) {
    return this.orders.verifyPayment(user, id, dto.reference);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  approve(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.orders.approve(user, id, dto);
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  dispute(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.dispute(user, id, dto);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  review(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.orders.review(user, id, dto);
  }

  @Post(':id/review/reply')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TAILOR)
  replyToReview(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReplyDto) {
    return this.orders.replyToReview(user, id, dto);
  }
}

/** Public: an artisan's reviews for their profile page. */
@Public()
@Controller('tailors/:id/reviews')
export class TailorReviewsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListReviewsQuery) {
    return this.orders.listReviews(id, query);
  }
}
