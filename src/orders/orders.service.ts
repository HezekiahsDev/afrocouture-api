import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, IsNull, LessThan, Not } from 'typeorm';
import { randomInt } from 'node:crypto';
import { Order, OrderMilestone, OrderStatus, FitSnapshot } from './entities/order.entity.js';
import { FabricFulfilment, OrderItem } from './entities/order-item.entity.js';
import { OrderEvent } from './entities/order-event.entity.js';
import {
  ApproveDto,
  CreateOrderDto,
  ListOrdersQuery,
  MilestoneDto,
  NoteDto,
  QuoteDto,
  ReasonDto,
  ResolveDisputeDto,
  ReviewDto,
  ReviewReplyDto,
} from './dto/order.dto.js';
import { sendOrderMail } from './orders-mail.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { EscrowTransaction, EscrowTransactionStatus } from '../escrow/entities/escrow-transaction.entity.js';
import { PaystackError, PaystackService } from '../payments/paystack.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../merchants/entities/merchant-profile.entity.js';
import { Fabric } from '../fabrics/entities/fabric.entity.js';
import { unitPriceFor } from '../fabrics/pricing.js';
import { CustomerFitProfile } from '../measurements/entities/customer-fit-profile.entity.js';
import { SavedItem, SavedItemType } from '../saved-items/entities/saved-item.entity.js';
import { AiDesign } from '../ai-studio/entities/ai-design.entity.js';
import { Style } from '../styles/entities/style.entity.js';
import { KycStatus, UserRole } from '../types/index.js';

/** Payload of the in-process 'order.event' (see docs/orders-payments-ai-contract.md). */
export interface OrderEventPayload {
  orderId: string;
  type: string;
  label: string;
  status: OrderStatus;
  milestone: OrderMilestone;
  actorUserId: string | null;
}

type Viewer = 'customer' | 'tailor' | 'merchant' | 'admin';

const MILESTONE_ORDER = [OrderMilestone.PLACED, OrderMilestone.CUTTING, OrderMilestone.FITTING, OrderMilestone.DELIVERY];
const MILESTONE_LABEL: Record<OrderMilestone, string> = {
  [OrderMilestone.PLACED]: 'Order placed',
  [OrderMilestone.CUTTING]: 'Cutting & sizing started',
  [OrderMilestone.FITTING]: 'Ready for first fitting',
  [OrderMilestone.DELIVERY]: 'Final finishing — preparing handover',
};
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;
/** Customers can rate an order for this long after it completes. */
const REVIEW_WINDOW_DAYS = 60;
const REVIEWABLE: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.REFUNDED];
const MEASUREMENTS = ['chest', 'shoulderWidth', 'sleeveLength', 'kaftanLength', 'waist', 'neck'] as const;

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);
  private readonly feePercent: number;
  private readonly frontendUrl: string;
  private readonly callbackUrl: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly escrow: EscrowService,
    private readonly paystack: PaystackService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {
    this.feePercent = Math.max(0, Number(config.get('PLATFORM_FEE_PERCENT') ?? 0) || 0);
    this.frontendUrl = (config.get<string>('FRONTEND_URL') ?? '').split(',')[0]?.trim().replace(/\/$/, '') || 'http://localhost:3000';
    this.callbackUrl = config.get<string>('PAYMENT_CALLBACK_URL') || `${this.frontendUrl}/orders/payment-callback`;
  }

  /** Auto-approve check runs every AUTO_APPROVE_CHECK_MS (default hourly). */
  onModuleInit() {
    const every = Number(this.config.get('AUTO_APPROVE_CHECK_MS') ?? 60 * 60 * 1000) || 60 * 60 * 1000;
    const timer = setInterval(() => {
      this.autoApproveDue().catch((err: unknown) => this.logger.error('Auto-approve run failed', err as Error));
    }, every);
    timer.unref?.();
    this.scheduler.addInterval('orders-auto-approve', timer);
  }

  // ───────────────────────── Create & read ─────────────────────────

  async create(customer: User, dto: CreateOrderDto) {
    const tailor = await this.dataSource.getRepository(TailorProfile).findOne({ where: { id: dto.tailorId } });
    if (!tailor || tailor.kycStatus !== KycStatus.APPROVED) throw new NotFoundException('This artisan could not be found.');
    if (tailor.isSample || !tailor.userId) {
      throw new ConflictException('This is a sample artisan profile and can’t take commissions. Choose a verified artisan.');
    }
    if (tailor.userId === customer.id) throw new BadRequestException('You can’t commission yourself.');

    const fit = await this.dataSource.getRepository(CustomerFitProfile).findOne({ where: { userId: customer.id } });
    if (!fit || !MEASUREMENTS.some((k) => fit[k] !== null) || !fit.deliveryAddress) {
      throw new BadRequestException(
        'Complete your fit profile — at least one measurement and a delivery address — before requesting a commission.',
      );
    }
    const fitSnapshot: FitSnapshot = {
      chest: fit.chest,
      shoulderWidth: fit.shoulderWidth,
      sleeveLength: fit.sleeveLength,
      kaftanLength: fit.kaftanLength,
      waist: fit.waist,
      neck: fit.neck,
      drapeSilhouette: fit.drapeSilhouette,
      unit: fit.unit,
      frontPhotoUrl: fit.frontPhotoUrl,
      sidePhotoUrl: fit.sidePhotoUrl,
    };

    if (dto.styleId && !(await this.dataSource.getRepository(Style).exists({ where: { id: dto.styleId } }))) {
      throw new BadRequestException('That style no longer exists.');
    }

    const referenceImageUrls = [...(dto.referenceImageUrls ?? [])];
    if (dto.aiDesignId) {
      const design = await this.dataSource
        .getRepository(AiDesign)
        .findOne({ where: { id: dto.aiDesignId, userId: customer.id } });
      if (!design) throw new BadRequestException('That design could not be found in your studio.');
      const image = design.imageUrls[design.selectedIndex] ?? design.imageUrls[0];
      if (image && !referenceImageUrls.includes(image)) referenceImageUrls.unshift(image);
    }

    const items = await this.buildItems(customer, dto);
    const fabricTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const { order, events } = await this.transaction(async (em, events) => {
      const order = em.create(Order, {
        reference: await this.uniqueReference(em),
        customerId: customer.id,
        tailorId: tailor.id,
        tailorUserId: tailor.userId!,
        status: OrderStatus.REQUESTED,
        milestone: OrderMilestone.PLACED,
        garmentType: dto.garmentType.trim(),
        brief: dto.brief.trim(),
        styleId: dto.styleId ?? null,
        aiDesignId: dto.aiDesignId ?? null,
        referenceImageUrls: referenceImageUrls.slice(0, 7),
        fitSnapshot,
        deliveryAddress: fit.deliveryAddress!,
        desiredDate: dto.desiredDate ?? null,
        fabricTotal,
        items: items.map((i) => em.create(OrderItem, i)),
      });
      const saved = await em.save(order);
      await this.record(em, events, saved, 'requested', `${customer.fullName ?? 'The customer'} requested a ${saved.garmentType}`, customer.id);
      return saved;
    });
    this.flush(events);

    void this.notifyUser(tailor.userId, `New commission request ${order.reference}`, [
      `${customer.fullName ?? 'A customer'} would like a ${order.garmentType}.`,
      'Review the brief and measurements, then send a quote or decline.',
    ], order.id, 'order_requested');
    return this.get(customer, order.id);
  }

  async list(user: User, query: ListOrdersQuery) {
    const role = query.role ?? this.defaultRole(user);
    const statuses = query.status
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatus => (Object.values(OrderStatus) as string[]).includes(s));
    const statusFilter = statuses?.length ? { status: In(statuses) } : {};
    const repo = this.dataSource.getRepository(Order);

    let orders: Order[];
    let merchantId: string | null = null;
    if (role === 'merchant') {
      const merchant = await this.dataSource.getRepository(MerchantProfile).findOne({ where: { userId: user.id } });
      if (!merchant) return [];
      merchantId = merchant.id;
      const ids = await this.dataSource
        .getRepository(OrderItem)
        .createQueryBuilder('i')
        .select('DISTINCT i.orderId', 'orderId')
        .where('i.merchantId = :m', { m: merchant.id })
        .getRawMany<{ orderId: string }>();
      if (!ids.length) return [];
      orders = await repo.find({
        where: { id: In(ids.map((r) => r.orderId)), ...statusFilter },
        relations: { items: true },
        order: { createdAt: 'DESC' },
      });
      // Before payment the order may still change or be cancelled — merchants see it once paid.
      orders = orders.filter((o) => o.paidAt !== null);
    } else {
      orders = await repo.find({
        where: { ...(role === 'tailor' ? { tailorUserId: user.id } : { customerId: user.id }), ...statusFilter },
        relations: { items: true },
        order: { createdAt: 'DESC' },
      });
    }

    const tailors = await this.tailorSummaries(orders.map((o) => o.tailorId));
    const customers = await this.userNames(orders.map((o) => o.customerId));
    return orders.map((o) => {
      const items = merchantId ? o.items.filter((i) => i.merchantId === merchantId) : o.items;
      const base = {
        id: o.id,
        reference: o.reference,
        status: o.status,
        milestone: o.milestone,
        garmentType: o.garmentType,
        referenceImageUrls: o.referenceImageUrls,
        estimatedDeliveryDate: o.estimatedDeliveryDate,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        tailor: tailors.get(o.tailorId) ?? null,
        customer: { id: o.customerId, fullName: customers.get(o.customerId) ?? null },
        items,
      };
      // Merchants only need their fabric lines and the atelier — not who the customer is or what they asked for.
      if (role === 'merchant') {
        return {
          ...base,
          referenceImageUrls: [],
          customer: { id: null, fullName: null },
          merchantTotal: items.reduce((s, i) => s + i.lineTotal, 0),
        };
      }
      return { ...base, totalAmount: o.totalAmount, fabricTotal: o.fabricTotal };
    });
  }

  async get(user: User, id: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id }, relations: { items: true } });
    if (!order) throw new NotFoundException('Order not found.');
    const viewer = await this.viewerOf(user, order);
    if (!viewer) throw new NotFoundException('Order not found.');
    return this.toView(order, viewer, user);
  }

  // ───────────────────────── Tailor: quote / decline ─────────────────────────

  async quote(user: User, id: string, dto: QuoteDto) {
    if (dto.estimatedDeliveryDate < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('The estimated delivery date must be in the future.');
    }
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      this.assertStatus(order, [OrderStatus.REQUESTED, OrderStatus.QUOTED], 'quote');
      const subtotal = dto.workmanshipPrice + dto.deliveryFee + order.fabricTotal;
      order.workmanshipPrice = dto.workmanshipPrice;
      order.deliveryFee = dto.deliveryFee;
      order.estimatedDeliveryDate = dto.estimatedDeliveryDate;
      order.quoteNote = dto.note?.trim() || null;
      order.quotedAt = new Date();
      order.platformFee = Math.round((subtotal * this.feePercent) / 100);
      order.totalAmount = subtotal + order.platformFee;
      order.status = OrderStatus.QUOTED;
      await em.save(order);
      await this.record(em, events, order, 'quoted', `Quote sent: ${naira(order.totalAmount)} total, ready by ${order.estimatedDeliveryDate}`, user.id, {
        workmanshipPrice: order.workmanshipPrice,
        deliveryFee: order.deliveryFee,
        fabricTotal: order.fabricTotal,
        platformFee: order.platformFee,
        totalAmount: order.totalAmount,
      });
      return order;
    });
    this.flush(events);
    void this.notifyUser(order.customerId, `Your quote for ${order.reference} is ready`, [
      `Your artisan quoted ${naira(order.totalAmount)} for your ${order.garmentType}, ready by ${order.estimatedDeliveryDate}.`,
      'Pay to confirm — your payment is held until you approve the finished piece.',
    ], order.id, 'order_quoted');
    return this.get(user, id);
  }

  async decline(user: User, id: string, dto: ReasonDto) {
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      this.assertStatus(order, [OrderStatus.REQUESTED, OrderStatus.QUOTED], 'decline');
      order.status = OrderStatus.DECLINED;
      order.declineReason = dto.reason.trim();
      await em.save(order);
      await this.record(em, events, order, 'declined', `The artisan declined: ${order.declineReason}`, user.id);
      return order;
    });
    this.flush(events);
    void this.notifyUser(order.customerId, `Your request ${order.reference} was declined`, [
      `Reason: ${order.declineReason}`,
      'You can browse other artisans and send a new request.',
    ], order.id, 'order_declined');
    return this.get(user, id);
  }

  async cancel(user: User, id: string) {
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertCustomer(order, user);
      this.assertStatus(order, [OrderStatus.REQUESTED, OrderStatus.QUOTED], 'cancel');
      order.status = OrderStatus.CANCELLED;
      order.cancelledAt = new Date();
      await em.save(order);
      await this.record(em, events, order, 'cancelled', 'The customer cancelled the request', user.id);
      return order;
    });
    this.flush(events);
    void this.notifyUser(order.tailorUserId, `Request ${order.reference} was cancelled`, [
      'The customer cancelled this commission request before paying.',
    ], order.id, 'order_cancelled');
    return this.get(user, id);
  }

  // ───────────────────────── Payment ─────────────────────────

  async pay(user: User, id: string) {
    this.paystack.assertConfigured();
    const { order } = await this.transaction(async (em) => {
      const order = await this.lockOrder(em, id);
      this.assertCustomer(order, user);
      this.assertStatus(order, [OrderStatus.QUOTED], 'pay for');
      const attempt = Number(order.paystackReference?.match(/-(\d+)$/)?.[1] ?? 0) + 1;
      order.paystackReference = `${order.reference}-${attempt}`;
      await em.save(order);
      return order;
    });

    try {
      const { authorizationUrl, reference } = await this.paystack.initialize({
        email: user.email,
        amountKobo: order.totalAmount * 100,
        reference: order.paystackReference!,
        callbackUrl: this.callbackUrl,
        metadata: { orderId: order.id, orderReference: order.reference },
      });
      return { authorizationUrl, reference };
    } catch (err) {
      if (err instanceof PaystackError) throw new BadGatewayException('Could not start the payment. Please try again.');
      throw err;
    }
  }

  /** Customer-initiated check after the Paystack redirect. */
  async verifyPayment(user: User, id: string, reference: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    this.assertCustomer(order, user);
    if (!reference.startsWith(`${order.reference}-`)) throw new BadRequestException('That payment does not belong to this order.');
    await this.confirmPayment(reference, user.id);
    return this.get(user, id);
  }

  /**
   * Verifies a Paystack transaction and, if it paid this order's current quote, moves the
   * order into escrow. Safe to call repeatedly and concurrently (webhook + redirect).
   */
  async confirmPayment(reference: string, actorUserId: string | null = null): Promise<void> {
    const orderRef = reference.split('-').slice(0, 2).join('-');
    const found = await this.dataSource.getRepository(Order).findOne({ where: { reference: orderRef } });
    if (!found) throw new NotFoundException('No order matches that payment.');

    let tx;
    try {
      tx = await this.paystack.verify(reference);
    } catch (err) {
      if (err instanceof PaystackError) throw new BadGatewayException('Could not confirm the payment with Paystack. Please try again.');
      throw err;
    }
    if (tx.status !== 'success') throw new BadRequestException('This payment was not completed.');
    const metadata = typeof tx.metadata === 'string' ? safeJson(tx.metadata) : tx.metadata;
    if (tx.currency !== 'NGN' || metadata?.orderId !== found.id) {
      throw new BadRequestException('That payment does not belong to this order.');
    }
    const paidNaira = Math.floor(tx.amount / 100);

    const refunds: EscrowTransaction[] = [];
    let mismatch = false;
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, found.id);
      if (await em.exists(EscrowTransaction, { where: { reference } })) return order; // already handled

      if (order.status === OrderStatus.QUOTED && tx.amount === order.totalAmount * 100) {
        await this.escrow.recordHold(em, order, reference, order.totalAmount);
        order.status = OrderStatus.PAID;
        order.paidAt = new Date();
        order.paystackReference = reference;
        order.milestone = OrderMilestone.PLACED;
        await em.save(order);
        await this.record(em, events, order, 'paid', `Payment of ${naira(order.totalAmount)} received and held in escrow`, actorUserId);
        return order;
      }

      // Paid for an outdated quote, or after the order was cancelled/declined/already paid: give it back.
      mismatch = true;
      await this.escrow.recordHold(em, order, reference, paidNaira);
      const refund = await this.escrow.reserveRefund(em, order, paidNaira);
      if (refund) refunds.push(refund);
      await this.record(em, events, order, 'payment_refunded', `A payment of ${naira(paidNaira)} didn't match this order and is being refunded`, actorUserId);
      return order;
    });
    for (const refund of refunds) await this.escrow.execute(refund);
    this.flush(events);

    if (mismatch) {
      void this.notifications.notify(order.customerId, {
        type: 'payment_refunded',
        title: `Your payment for ${order.reference} is being refunded`,
        body: `It didn't match the current quote. Paystack returns it to your card or account, usually within a few days.`,
        link: `/orders/${order.id}`,
        orderId: order.id,
      });
      throw new ConflictException('That payment didn’t match the current quote, so it is being refunded. Please pay again.');
    }
    if (events.some((e) => e.type === 'paid')) void this.notifyPaid(order);
  }

  // ───────────────────────── Production ─────────────────────────

  async advanceMilestone(user: User, id: string, dto: MilestoneDto) {
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      this.assertStatus(order, [OrderStatus.PAID, OrderStatus.IN_PROGRESS], 'update');
      if (MILESTONE_ORDER.indexOf(dto.milestone) <= MILESTONE_ORDER.indexOf(order.milestone)) {
        throw new BadRequestException('Milestones only move forward.');
      }
      order.milestone = dto.milestone;
      order.status = OrderStatus.IN_PROGRESS;
      await em.save(order);
      const note = dto.note?.trim();
      await this.record(em, events, order, 'milestone', note ? `${MILESTONE_LABEL[dto.milestone]} — ${note}` : MILESTONE_LABEL[dto.milestone], user.id, {
        milestone: dto.milestone,
      });
      return order;
    });
    this.flush(events);
    void this.notifications.notify(order.customerId, {
      type: 'order_milestone',
      title: `${MILESTONE_LABEL[dto.milestone]} · ${order.reference}`,
      body: dto.note?.trim() || `Your artisan has moved your ${order.garmentType} to the next stage.`,
      link: `/orders/${order.id}`,
      orderId: order.id,
    });
    return this.get(user, id);
  }

  async shipItem(user: User, id: string, itemId: string, dto: NoteDto) {
    const merchant = await this.dataSource.getRepository(MerchantProfile).findOne({ where: { userId: user.id } });
    const { order, item, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      const item = await em.findOne(OrderItem, { where: { id: itemId, orderId: id } });
      if (!item || !merchant || item.merchantId !== merchant.id) throw new NotFoundException('Order not found.');
      this.assertStatus(order, [OrderStatus.PAID, OrderStatus.IN_PROGRESS], 'ship fabric for');
      if (item.fulfilment !== FabricFulfilment.PENDING) throw new ConflictException('This fabric is already marked as shipped.');
      item.fulfilment = FabricFulfilment.SHIPPED;
      item.shippedAt = new Date();
      item.shippingNote = dto.note?.trim() || null;
      await em.save(item);
      await this.record(em, events, order, 'fabric_shipped', `${item.fabricName} shipped to the atelier${item.shippingNote ? ` (${item.shippingNote})` : ''}`, user.id, {
        itemId: item.id,
      });
      return { order, item };
    }).then(({ order: result, events }) => ({ ...result, events }));
    this.flush(events);
    void this.notifyUser(order.tailorUserId, `Fabric on its way for ${order.reference}`, [
      `${item.quantity} ${item.unit}${item.quantity === 1 ? '' : 's'} of ${item.fabricName} has been shipped to you.`,
      item.shippingNote ? `Shipping note: ${item.shippingNote}` : 'Mark it as received when it arrives.',
    ], order.id, 'fabric_shipped');
    return this.get(user, id);
  }

  async receiveItem(user: User, id: string, itemId: string) {
    const payouts: EscrowTransaction[] = [];
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      const item = await em.findOne(OrderItem, { where: { id: itemId, orderId: id } });
      if (!item) throw new NotFoundException('Fabric line not found.');
      this.assertStatus(order, [OrderStatus.PAID, OrderStatus.IN_PROGRESS, OrderStatus.DELIVERED], 'receive fabric for');
      if (item.fulfilment !== FabricFulfilment.SHIPPED) {
        throw new ConflictException(
          item.fulfilment === FabricFulfilment.RECEIVED ? 'Already marked as received.' : 'The merchant has not shipped this fabric yet.',
        );
      }
      item.fulfilment = FabricFulfilment.RECEIVED;
      item.receivedAt = new Date();
      await em.save(item);
      await this.record(em, events, order, 'fabric_received', `${item.fabricName} received at the atelier`, user.id, { itemId: item.id });

      // Pay the merchant once all of their fabric on this order has arrived.
      const lines = await em.find(OrderItem, { where: { orderId: id, merchantId: item.merchantId } });
      if (lines.every((l) => l.fulfilment === FabricFulfilment.RECEIVED)) {
        const amount = lines.reduce((s, l) => s + l.lineTotal, 0);
        const payout = await this.escrow.reserveRelease(em, order, { type: 'merchant', id: item.merchantId }, amount);
        if (payout) {
          payouts.push(payout);
          await this.record(em, events, order, 'payout', `${naira(payout.amount)} released to the fabric merchant`, null, {
            transactionId: payout.id,
          });
        }
      }
      return order;
    });
    for (const p of payouts) await this.escrow.execute(p);
    this.flush(events);
    for (const payout of payouts) void this.notifyMerchantPaid(order, payout);
    return this.get(user, id);
  }

  async deliver(user: User, id: string, dto: NoteDto) {
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      this.assertStatus(order, [OrderStatus.IN_PROGRESS], 'hand over');
      if (order.milestone !== OrderMilestone.DELIVERY) {
        throw new BadRequestException('Move the order to the handover stage before marking it delivered.');
      }
      order.status = OrderStatus.DELIVERED;
      order.deliveredAt = new Date();
      await em.save(order);
      const note = dto.note?.trim();
      await this.record(em, events, order, 'delivered', note ? `Handed over — ${note}` : 'Your piece has been handed over', user.id);
      return order;
    });
    this.flush(events);
    void this.notifyUser(order.customerId, `Your ${order.garmentType} has been delivered`, [
      'Check it over. When you’re happy, approve the order to release payment to your artisan.',
      'If something is wrong, open a dispute from the order page instead.',
    ], order.id, 'order_delivered');
    return this.get(user, id);
  }

  async approve(user: User, id: string, dto: ApproveDto) {
    const payouts: EscrowTransaction[] = [];
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertCustomer(order, user);
      this.assertStatus(order, [OrderStatus.DELIVERED], 'approve');
      order.rating = dto.rating;
      order.review = dto.review?.trim() || null;
      order.reviewedAt = new Date();
      await this.completeOrder(em, events, order, payouts, user.id, 'completed', 'Order approved — payment released to the artisan');
      await this.recomputeRating(em, order.tailorId);
      return order;
    });
    for (const p of payouts) await this.escrow.execute(p);
    this.flush(events);
    void this.notifyUser(order.tailorUserId, `Order ${order.reference} approved`, [
      `The customer approved the order and rated it ${dto.rating}/5. Your payout is on its way.`,
    ], order.id, 'order_completed');
    return this.get(user, id);
  }

  async dispute(user: User, id: string, dto: ReasonDto) {
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertCustomer(order, user);
      this.assertStatus(order, [OrderStatus.PAID, OrderStatus.IN_PROGRESS, OrderStatus.DELIVERED], 'dispute');
      order.status = OrderStatus.DISPUTED;
      order.disputeReason = dto.reason.trim();
      order.disputedAt = new Date();
      await em.save(order);
      await this.record(em, events, order, 'disputed', `The customer opened a dispute: ${order.disputeReason}`, user.id);
      return order;
    });
    this.flush(events);
    void this.notifyUser(order.tailorUserId, `A dispute was opened on ${order.reference}`, [
      `Reason: ${order.disputeReason}`,
      'Payment stays in escrow while our team reviews it. Reply in the order chat with anything that helps.',
    ], order.id, 'order_disputed');
    void this.notifications.notifyAdmins({
      type: 'admin_dispute',
      title: `Dispute opened on ${order.reference}`,
      body: order.disputeReason,
      link: `/admin/orders/${order.id}`,
      orderId: order.id,
    });
    return this.get(user, id);
  }

  // ───────────────────────── Reviews ─────────────────────────

  /** Rate an order after it finished without one (auto-completed, or settled by our team). */
  async review(user: User, id: string, dto: ReviewDto) {
    const order = await this.dataSource.transaction(async (em) => {
      const order = await this.lockOrder(em, id);
      this.assertCustomer(order, user);
      this.assertStatus(order, REVIEWABLE, 'review');
      if (order.rating !== null) throw new ConflictException('You have already reviewed this order.');
      const finished = order.completedAt ?? order.updatedAt;
      if (Date.now() - finished.getTime() > REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
        throw new ConflictException(`Reviews can be left up to ${REVIEW_WINDOW_DAYS} days after an order completes.`);
      }
      order.rating = dto.rating;
      order.review = dto.review?.trim() || null;
      order.reviewedAt = new Date();
      await em.save(order);
      await this.recomputeRating(em, order.tailorId);
      return order;
    });
    void this.notifications.notify(order.tailorUserId, {
      type: 'review',
      title: `New ${order.rating}-star review · ${order.reference}`,
      body: order.review ?? `Your customer rated their ${order.garmentType}.`,
      link: `/orders/${order.id}#review`,
      orderId: order.id,
    });
    return this.get(user, id);
  }

  async replyToReview(user: User, id: string, dto: ReviewReplyDto) {
    const order = await this.dataSource.transaction(async (em) => {
      const order = await this.lockOrder(em, id);
      this.assertTailor(order, user);
      if (order.rating === null) throw new ConflictException('There is no review to reply to yet.');
      if (order.reviewReply) throw new ConflictException('You have already replied to this review.');
      order.reviewReply = dto.reply.trim();
      order.reviewRepliedAt = new Date();
      return em.save(order);
    });
    void this.notifications.notify(order.customerId, {
      type: 'review_reply',
      title: `Your artisan replied to your review · ${order.reference}`,
      body: order.reviewReply,
      link: `/orders/${order.id}#review`,
      orderId: order.id,
    });
    return this.get(user, id);
  }

  /** Public reviews for an artisan's profile, newest first, with the rating breakdown. */
  async listReviews(tailorId: string, query: { limit?: number; before?: string }) {
    const tailor = await this.dataSource.getRepository(TailorProfile).findOne({
      where: { id: tailorId, kycStatus: KycStatus.APPROVED },
      select: { id: true, rating: true, reviewCount: true },
    });
    if (!tailor) throw new NotFoundException('This artisan could not be found.');
    const limit = query.limit ?? 10;
    const visible = { tailorId, rating: Not(IsNull()), reviewHiddenAt: IsNull() };
    const orders = await this.dataSource.getRepository(Order).find({
      where: query.before ? { ...visible, reviewedAt: LessThan(new Date(query.before)) } : visible,
      order: { reviewedAt: 'DESC' },
      take: limit + 1,
      select: { id: true, customerId: true, garmentType: true, rating: true, review: true, reviewedAt: true, reviewReply: true, reviewRepliedAt: true },
    });
    const names = await this.userNames(orders.map((o) => o.customerId));
    const breakdown = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .select('o.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('o.tailorId = :tailorId AND o.rating IS NOT NULL AND o.reviewHiddenAt IS NULL', { tailorId })
      .groupBy('o.rating')
      .getRawMany<{ rating: number; count: string }>();
    return {
      rating: tailor.rating === null ? null : Number(tailor.rating),
      reviewCount: tailor.reviewCount,
      breakdown: Object.fromEntries([5, 4, 3, 2, 1].map((r) => [r, Number(breakdown.find((b) => Number(b.rating) === r)?.count ?? 0)])),
      items: orders.slice(0, limit).map((o) => ({
        id: o.id,
        rating: o.rating,
        review: o.review,
        garmentType: o.garmentType,
        reviewerName: shortName(names.get(o.customerId)),
        reviewedAt: o.reviewedAt,
        reply: o.reviewReply,
        repliedAt: o.reviewRepliedAt,
      })),
      hasMore: orders.length > limit,
    };
  }

  // ───────────────────────── Admin ─────────────────────────

  /** Recent reviews for moderation, newest first. */
  async listReviewsForAdmin(query: { limit?: number; before?: string }) {
    const limit = query.limit ?? 30;
    const reviewed = { rating: Not(IsNull()) };
    const orders = await this.dataSource.getRepository(Order).find({
      where: query.before ? { ...reviewed, reviewedAt: LessThan(new Date(query.before)) } : reviewed,
      order: { reviewedAt: 'DESC' },
      take: limit + 1,
      select: {
        id: true, reference: true, customerId: true, tailorId: true, garmentType: true, rating: true, review: true,
        reviewedAt: true, reviewReply: true, reviewHiddenAt: true,
      },
    });
    const tailors = await this.tailorSummaries(orders.map((o) => o.tailorId));
    const customers = await this.userNames(orders.map((o) => o.customerId));
    return {
      items: orders.slice(0, limit).map((o) =>
        Object.assign({}, o, {
          tailor: tailors.get(o.tailorId) ?? null,
          customer: { id: o.customerId, fullName: customers.get(o.customerId) ?? null },
        }),
      ),
      hasMore: orders.length > limit,
    };
  }

  async setReviewHidden(id: string, hidden: boolean) {
    return this.dataSource.transaction(async (em) => {
      const order = await this.lockOrder(em, id);
      if (order.rating === null) throw new NotFoundException('This order has no review.');
      order.reviewHiddenAt = hidden ? (order.reviewHiddenAt ?? new Date()) : null;
      await em.save(order);
      await this.recomputeRating(em, order.tailorId);
      return { id: order.id, reviewHiddenAt: order.reviewHiddenAt };
    });
  }


  /**
   * Every order for the admin console, newest first. `statuses` empty = all; `q` matches the
   * reference, the customer's name or email, or the artisan's name.
   */
  async listForAdmin(opts: { statuses?: OrderStatus[]; q?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const qb = this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoin(User, 'cu', 'cu.id = o.customerId')
      .leftJoin(TailorProfile, 'tp', 'tp.id = o.tailorId');
    if (opts.statuses?.length) qb.andWhere('o.status IN (:...statuses)', { statuses: opts.statuses });
    if (opts.q?.trim()) {
      const like = `%${opts.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('o.reference ILIKE :like', { like })
            .orWhere('cu.fullName ILIKE :like', { like })
            .orWhere('cu.email ILIKE :like', { like })
            .orWhere('tp.displayName ILIKE :like', { like })
            .orWhere('tp.atelierName ILIKE :like', { like }),
        ),
      );
    }
    const [orders, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const tailors = await this.tailorSummaries(orders.map((o) => o.tailorId));
    const customers = await this.userNames(orders.map((o) => o.customerId));
    const items = await Promise.all(
      orders.map(async (o) =>
        Object.assign({}, o, {
          tailor: tailors.get(o.tailorId) ?? null,
          customer: { id: o.customerId, fullName: customers.get(o.customerId) ?? null },
          escrow: await this.escrow.summary(o.id),
        }),
      ),
    );
    return { items, total, page, limit };
  }

  /** Escrow transactions in a status (default: failed payouts) with the order and payee they belong to. */
  async escrowQueue(status: EscrowTransactionStatus | 'all') {
    const txs = await this.escrow.listByStatus(status);
    const orders = await this.dataSource
      .getRepository(Order)
      .find({ where: { id: In([...new Set(txs.map((t) => t.orderId))]) }, select: { id: true, reference: true, status: true } });
    const tailors = await this.dataSource.getRepository(TailorProfile).find({
      where: { id: In(txs.filter((t) => t.partyType === 'tailor').map((t) => t.partyId)) },
      select: { id: true, displayName: true, atelierName: true, bankName: true, bankCode: true, accountNumber: true, accountName: true },
    });
    const merchants = await this.dataSource.getRepository(MerchantProfile).find({
      where: { id: In(txs.filter((t) => t.partyType === 'merchant').map((t) => t.partyId)) },
      select: { id: true, businessName: true, bankName: true, bankCode: true, accountNumber: true, accountName: true },
    });
    const customers = await this.userNames(txs.filter((t) => t.partyType === 'customer').map((t) => t.partyId));
    return txs.map((tx) => {
      const tailor = tailors.find((t) => t.id === tx.partyId);
      const merchant = merchants.find((m) => m.id === tx.partyId);
      const payee = tailor
        ? { name: tailor.atelierName ?? tailor.displayName, bankName: tailor.bankName, accountNumber: tailor.accountNumber, accountName: tailor.accountName, payoutReady: Boolean(tailor.bankCode && tailor.accountNumber) }
        : merchant
          ? { name: merchant.businessName, bankName: merchant.bankName, accountNumber: merchant.accountNumber, accountName: merchant.accountName, payoutReady: Boolean(merchant.bankCode && merchant.accountNumber) }
          : { name: customers.get(tx.partyId) ?? 'Customer', bankName: null, accountNumber: null, accountName: null, payoutReady: true };
      return Object.assign({}, tx, { order: orders.find((o) => o.id === tx.orderId) ?? null, payee });
    });
  }

  async resolveDispute(admin: User, id: string, dto: ResolveDisputeDto) {
    const transfers: EscrowTransaction[] = [];
    const { order, events } = await this.transaction(async (em, events) => {
      const order = await this.lockOrder(em, id);
      this.assertStatus(order, [OrderStatus.DISPUTED], 'resolve');
      order.resolutionNote = dto.note.trim();

      if (dto.outcome === 'release') {
        await this.completeOrder(em, events, order, transfers, admin.id, 'resolved', `Dispute resolved in the artisan’s favour: ${order.resolutionNote}`);
        return order;
      }

      const { balance } = await this.escrow.summary(order.id, em);
      const amount = Math.min(dto.refundAmount ?? balance, balance);
      if (amount <= 0) throw new ConflictException('There is nothing left in escrow to refund.');
      const refund = await this.escrow.reserveRefund(em, order, amount);
      if (refund) transfers.push(refund);
      // Whatever isn't refunded goes to the people who did the work.
      await this.releaseRemaining(em, order, transfers);
      order.status = OrderStatus.REFUNDED;
      order.completedAt = new Date();
      await em.save(order);
      await this.record(em, events, order, 'resolved', `Dispute resolved: ${naira(amount)} refunded to the customer. ${order.resolutionNote}`, admin.id, {
        refundAmount: amount,
      });
      return order;
    });
    for (const t of transfers) await this.escrow.execute(t);
    this.flush(events);
    const lines = [`Our team resolved the dispute on ${order.reference}.`, `Decision: ${order.resolutionNote}`];
    void this.notifyUser(order.customerId, `Dispute resolved — ${order.reference}`, lines, order.id, 'order_resolved');
    void this.notifyUser(order.tailorUserId, `Dispute resolved — ${order.reference}`, lines, order.id, 'order_resolved');
    return this.get(admin, id);
  }

  /** Completes delivered orders nobody approved or disputed within AUTO_APPROVE_DAYS. */
  async autoApproveDue(now = new Date()): Promise<number> {
    const days = Math.max(0, Number(this.config.get('AUTO_APPROVE_DAYS') ?? 7));
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const due = await this.dataSource.getRepository(Order).find({
      where: { status: OrderStatus.DELIVERED, deliveredAt: LessThan(cutoff) },
      select: { id: true },
    });
    let completed = 0;
    for (const { id } of due) {
      const payouts: EscrowTransaction[] = [];
      const { order, events } = await this.transaction(async (em, events) => {
        const order = await this.lockOrder(em, id);
        if (order.status !== OrderStatus.DELIVERED) return order;
        await this.completeOrder(em, events, order, payouts, null, 'auto_completed', `Completed automatically ${days} days after delivery — payment released`);
        return order;
      });
      for (const p of payouts) await this.escrow.execute(p);
      this.flush(events);
      if (order.status === OrderStatus.COMPLETED) {
        completed++;
        void this.notifyUser(order.tailorUserId, `Order ${order.reference} completed`, ['The order was completed automatically and your payout is on its way.'], order.id, 'order_completed');
        void this.notifications.notify(order.customerId, {
          type: 'order_completed',
          title: `Order ${order.reference} is complete`,
          body: `How was your ${order.garmentType}? Rate your artisan to help other customers.`,
          link: `/orders/${order.id}#review`,
          orderId: order.id,
        });
      }
    }
    return completed;
  }

  // ───────────────────────── Internals ─────────────────────────

  /** Runs `fn` in a transaction; order events it records are emitted only after commit. */
  private async transaction<T>(fn: (em: EntityManager, events: OrderEventPayload[]) => Promise<T>) {
    const events: OrderEventPayload[] = [];
    const order = await this.dataSource.transaction((em) => fn(em, events));
    return { order, events };
  }

  private flush(events: OrderEventPayload[]) {
    for (const e of events) this.events.emit('order.event', e);
  }

  /** Saves an OrderEvent and queues the 'order.event' notification for after commit. */
  private async record(
    em: EntityManager,
    queue: OrderEventPayload[],
    order: Order,
    type: string,
    label: string,
    actorUserId: string | null,
    data?: Record<string, unknown>,
  ) {
    await em.save(em.create(OrderEvent, { orderId: order.id, type, label, actorUserId, data: data ?? null }));
    queue.push({ orderId: order.id, type, label, status: order.status, milestone: order.milestone, actorUserId });
  }

  private async completeOrder(
    em: EntityManager,
    events: OrderEventPayload[],
    order: Order,
    payouts: EscrowTransaction[],
    actorUserId: string | null,
    type: string,
    label: string,
  ) {
    order.status = OrderStatus.COMPLETED;
    order.completedAt = new Date();
    await em.save(order);
    await this.releaseRemaining(em, order, payouts);
    await this.record(em, events, order, type, label, actorUserId);
  }

  /** Pays merchants for any unpaid fabric, then the tailor their workmanship + delivery (capped by the balance). */
  private async releaseRemaining(em: EntityManager, order: Order, payouts: EscrowTransaction[]) {
    const items = await em.find(OrderItem, { where: { orderId: order.id } });
    const byMerchant = new Map<string, number>();
    for (const item of items) byMerchant.set(item.merchantId, (byMerchant.get(item.merchantId) ?? 0) + item.lineTotal);
    for (const [merchantId, amount] of byMerchant) {
      const payout = await this.escrow.reserveRelease(em, order, { type: 'merchant', id: merchantId }, amount);
      if (payout) payouts.push(payout);
    }
    const tailorAmount = (order.workmanshipPrice ?? 0) + (order.deliveryFee ?? 0);
    const payout = await this.escrow.reserveRelease(em, order, { type: 'tailor', id: order.tailorId }, tailorAmount);
    if (payout) payouts.push(payout);
  }

  /** Sets the artisan's average and count from their visible reviews (sample artisans keep their seeded figures). */
  private async recomputeRating(em: EntityManager, tailorId: string) {
    const tailor = await em.findOne(TailorProfile, { where: { id: tailorId }, select: { id: true, isSample: true } });
    if (!tailor || tailor.isSample) return;
    const row = await em
      .createQueryBuilder(Order, 'o')
      .select('AVG(o.rating)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('o.tailorId = :tailorId', { tailorId })
      .andWhere('o.rating IS NOT NULL')
      .andWhere('o.reviewHiddenAt IS NULL')
      .getRawOne<{ avg: string | null; count: string }>();
    const count = Number(row?.count ?? 0);
    await em.update(TailorProfile, tailorId, {
      rating: count ? Number(row!.avg).toFixed(1) : null,
      reviewCount: count,
    });
  }

  private async notifyMerchantPaid(order: Order, payout: EscrowTransaction) {
    const merchant = await this.dataSource.getRepository(MerchantProfile).findOne({ where: { id: payout.partyId }, select: { id: true, userId: true } });
    await this.notifications.notify(merchant?.userId, {
      type: 'payout',
      title: `Fabric received · ${order.reference}`,
      body: `The artisan confirmed your fabric arrived. ${naira(payout.amount)} is on its way to your bank account.`,
      link: `/orders/${order.id}`,
      orderId: order.id,
    });
  }

  private async buildItems(
    customer: User,
    dto: CreateOrderDto,
  ): Promise<Pick<OrderItem, 'fabricId' | 'merchantId' | 'fabricName' | 'imageUrl' | 'unit' | 'quantity' | 'unitPrice' | 'lineTotal'>[]> {
    const wanted = new Map<string, number>();
    if (dto.useSavedFabrics) {
      const saved = await this.dataSource
        .getRepository(SavedItem)
        .find({ where: { userId: customer.id, itemType: SavedItemType.FABRIC } });
      for (const s of saved) wanted.set(s.itemId, s.quantity ?? 1);
    }
    for (const f of dto.fabrics ?? []) wanted.set(f.fabricId, f.quantity);
    if (wanted.size > 5) throw new BadRequestException('Add at most 5 fabrics to one order.');
    if (!wanted.size) return [];

    const fabrics = await this.dataSource
      .getRepository(Fabric)
      .find({ where: { id: In([...wanted.keys()]) }, relations: { merchant: true } });
    return [...wanted.entries()].map(([fabricId, quantity]) => {
      const fabric = fabrics.find((f) => f.id === fabricId);
      if (!fabric || !fabric.isPublished || fabric.merchant.verificationStatus !== KycStatus.APPROVED) {
        throw new BadRequestException('One of the fabrics is no longer available. Remove it and try again.');
      }
      if (fabric.isSample || fabric.merchant.isSample) {
        throw new BadRequestException(`${fabric.name} is a sample listing and can’t be ordered.`);
      }
      if (quantity < 1 || quantity > 200) throw new BadRequestException('Fabric quantities must be between 1 and 200.');
      const unitPrice = unitPriceFor(fabric, quantity);
      return {
        fabricId: fabric.id,
        merchantId: fabric.merchantId,
        fabricName: fabric.name,
        imageUrl: fabric.imageUrl,
        unit: fabric.unit,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
      };
    });
  }

  private async uniqueReference(em: EntityManager): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const ref = `AC-${Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')}`;
      if (!(await em.exists(Order, { where: { reference: ref } }))) return ref;
    }
    throw new Error('Could not allocate an order reference');
  }

  private lockOrder(em: EntityManager, id: string): Promise<Order> {
    return em
      .findOne(Order, { where: { id }, lock: { mode: 'pessimistic_write' } })
      .then((order) => {
        if (!order) throw new NotFoundException('Order not found.');
        return order;
      });
  }

  private assertCustomer(order: Order, user: User) {
    if (order.customerId !== user.id) throw new NotFoundException('Order not found.');
  }

  private assertTailor(order: Order, user: User) {
    if (order.tailorUserId !== user.id) throw new NotFoundException('Order not found.');
  }

  private assertStatus(order: Order, allowed: OrderStatus[], action: string) {
    if (!allowed.includes(order.status)) {
      throw new ConflictException(`You can’t ${action} an order that is ${order.status.replace('_', ' ')}.`);
    }
  }

  private defaultRole(user: User): 'customer' | 'tailor' | 'merchant' {
    if (user.role === UserRole.TAILOR) return 'tailor';
    if (user.role === UserRole.MERCHANT) return 'merchant';
    return 'customer';
  }

  private async viewerOf(user: User, order: Order): Promise<Viewer | null> {
    if (user.role === UserRole.ADMIN) return 'admin';
    if (order.customerId === user.id) return 'customer';
    if (order.tailorUserId === user.id) return 'tailor';
    if (order.paidAt) {
      const merchant = await this.dataSource.getRepository(MerchantProfile).findOne({ where: { userId: user.id } });
      if (merchant && order.items.some((i) => i.merchantId === merchant.id)) return 'merchant';
    }
    return null;
  }

  private async toView(order: Order, viewer: Viewer, user: User) {
    const [tailors, customers, events, escrow] = await Promise.all([
      this.tailorSummaries([order.tailorId]),
      this.userNames([order.customerId]),
      this.dataSource.getRepository(OrderEvent).find({ where: { orderId: order.id }, order: { createdAt: 'ASC' } }),
      this.escrow.summary(order.id),
    ]);
    const tailor = tailors.get(order.tailorId) ?? null;
    const customer = { id: order.customerId, fullName: customers.get(order.customerId) ?? null };

    if (viewer === 'merchant') {
      const merchant = await this.dataSource.getRepository(MerchantProfile).findOne({ where: { userId: user.id } });
      const workshop = await this.dataSource.getRepository(TailorProfile).findOne({ where: { id: order.tailorId } });
      const items = order.items.filter((i) => i.merchantId === merchant?.id);
      return {
        viewerRole: viewer,
        id: order.id,
        reference: order.reference,
        status: order.status,
        milestone: order.milestone,
        garmentType: order.garmentType,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        tailor,
        items,
        merchantTotal: items.reduce((s, i) => s + i.lineTotal, 0),
        shipTo: workshop
          ? { name: workshop.atelierName ?? workshop.displayName, address: workshop.workshopAddress, city: workshop.city }
          : null,
        events: events.filter((e) => ['paid', 'fabric_shipped', 'fabric_received', 'completed', 'resolved'].includes(e.type)),
      };
    }

    const sortedItems = [...order.items].sort((a, b) => +a.createdAt - +b.createdAt);
    const view = Object.assign({ viewerRole: viewer }, order, { items: sortedItems, tailor, customer, events, escrow });
    if (viewer === 'admin') return Object.assign(view, { escrowTransactions: await this.escrow.listForOrder(order.id) });
    return view;
  }

  private async tailorSummaries(ids: string[]) {
    const unique = [...new Set(ids)];
    const map = new Map<string, Pick<TailorProfile, 'id' | 'displayName' | 'atelierName' | 'portraitUrl' | 'city'>>();
    if (!unique.length) return map;
    const rows = await this.dataSource.getRepository(TailorProfile).find({
      where: { id: In(unique) },
      select: { id: true, displayName: true, atelierName: true, portraitUrl: true, city: true },
    });
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  private async userNames(ids: string[]) {
    const unique = [...new Set(ids)];
    const map = new Map<string, string | null>();
    if (!unique.length) return map;
    const rows = await this.dataSource.getRepository(User).find({ where: { id: In(unique) }, select: { id: true, fullName: true } });
    for (const r of rows) map.set(r.id, r.fullName ?? null);
    return map;
  }

  /** Emails the person and adds the same update to their notification centre. */
  private async notifyUser(userId: string, subject: string, lines: string[], orderId: string, type: string) {
    void this.notifications.notify(userId, { type, title: subject, body: lines[0], link: `/orders/${orderId}`, orderId });
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    await sendOrderMail(this.mail, user?.email, subject, lines, `${this.frontendUrl}/orders/${orderId}`);
  }

  private async notifyPaid(order: Order) {
    await this.notifyUser(order.tailorUserId, `Payment received for ${order.reference}`, [
      `The customer paid ${naira(order.totalAmount)}; it is held in escrow until they approve the finished piece.`,
      'You can start work. Update the milestones as you go.',
    ], order.id, 'order_paid');

    const items = await this.dataSource.getRepository(OrderItem).find({ where: { orderId: order.id } });
    if (!items.length) return;
    const workshop = await this.dataSource.getRepository(TailorProfile).findOne({ where: { id: order.tailorId } });
    const merchants = await this.dataSource.getRepository(MerchantProfile).find({ where: { id: In([...new Set(items.map((i) => i.merchantId))]) } });
    for (const merchant of merchants) {
      if (!merchant.userId) continue;
      const mine = items.filter((i) => i.merchantId === merchant.id);
      await this.notifyUser(merchant.userId, `New fabric order ${order.reference}`, [
        'Please ship the following to the artisan’s atelier:',
        ...mine.map((i) => `• ${i.quantity} ${i.unit}${i.quantity === 1 ? '' : 's'} of ${i.fabricName}`),
        `Ship to: ${workshop?.atelierName ?? 'the atelier'}, ${workshop?.workshopAddress ?? ''}${workshop?.city ? `, ${workshop.city}` : ''}`,
        'You are paid once the artisan confirms the fabric has arrived.',
      ], order.id, 'fabric_order');
    }
  }
}

function safeJson(value: string): { orderId?: string } | null {
  try {
    return JSON.parse(value) as { orderId?: string };
  } catch {
    return null;
  }
}

/** "Adaeze Okafor" → "Adaeze O." — reviews show first name and initial only. */
function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AfroCouture customer';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
