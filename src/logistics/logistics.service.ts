import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In, DataSource } from 'typeorm';
import {
  DaliDelivery,
  DaliError,
  DaliLogisticsService,
  DaliRunner,
  DaliWebhookEvent,
} from './dali-logistics.service.js';
import {
  LogisticsDelivery,
  LogisticsRunner,
  LogisticsStatus,
  LogisticsStop,
  LogisticsWebhookEvent,
} from './entities/logistics-delivery.entity.js';
import { CreateDeliveryDto, DeliveryStopDto, QuoteDeliveryDto } from './dto/delivery.dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Order, OrderMilestone, OrderStatus } from '../orders/entities/order.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

type Viewer = 'customer' | 'tailor' | 'admin';

const ACTIVE_STATUSES = [
  LogisticsStatus.PENDING,
  LogisticsStatus.ASSIGNED,
  LogisticsStatus.PICKED_UP,
  LogisticsStatus.IN_TRANSIT,
];

/** Dali status → the event that announced it. */
const EVENT_STATUS: Record<string, LogisticsStatus> = {
  'delivery.created': LogisticsStatus.PENDING,
  'delivery.routed': LogisticsStatus.PENDING,
  'delivery.assigned': LogisticsStatus.ASSIGNED,
  'delivery.unassigned': LogisticsStatus.PENDING,
  'delivery.picked_up': LogisticsStatus.PICKED_UP,
  'delivery.in_transit': LogisticsStatus.IN_TRANSIT,
  'delivery.delivered': LogisticsStatus.DELIVERED,
  'delivery.completed': LogisticsStatus.COMPLETED,
  'delivery.cancelled': LogisticsStatus.CANCELLED,
  'delivery.failed': LogisticsStatus.FAILED,
  'delivery.disputed': LogisticsStatus.DISPUTED,
};

const TIMESTAMP_COLUMNS: Partial<Record<LogisticsStatus, keyof LogisticsDelivery>> = {
  [LogisticsStatus.ASSIGNED]: 'assignedAt',
  [LogisticsStatus.PICKED_UP]: 'pickedUpAt',
  [LogisticsStatus.DELIVERED]: 'deliveredAt',
  [LogisticsStatus.COMPLETED]: 'completedAt',
  [LogisticsStatus.CANCELLED]: 'cancelledAt',
  [LogisticsStatus.FAILED]: 'failedAt',
};

const statusLabel: Record<LogisticsStatus, string> = {
  [LogisticsStatus.PENDING]: 'Looking for a rider',
  [LogisticsStatus.ASSIGNED]: 'Rider assigned',
  [LogisticsStatus.PICKED_UP]: 'Picked up',
  [LogisticsStatus.IN_TRANSIT]: 'On the way',
  [LogisticsStatus.DELIVERED]: 'Delivered',
  [LogisticsStatus.COMPLETED]: 'Completed',
  [LogisticsStatus.CANCELLED]: 'Cancelled',
  [LogisticsStatus.FAILED]: 'Delivery failed',
  [LogisticsStatus.DISPUTED]: 'Under review',
};

/** Dali rider delivery: quotes, booking, tracking and webhook reconciliation. */
@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dali: DaliLogisticsService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────── For an order ─────────────────────────

  /** The current (or latest) rider job for an order, if one exists. */
  async getForOrder(user: User, orderId: string) {
    const order = await this.orderFor(user, orderId, 'view');
    const delivery = await this.latestForOrder(orderId);
    if (!delivery) return null;
    return this.toView(delivery, this.viewerOf(user, order));
  }

  /** Prices a route before the artisan books it. Dali re-quotes on creation anyway. */
  async quoteForOrder(user: User, orderId: string, dto: QuoteDeliveryDto) {
    const order = await this.orderFor(user, orderId, 'manage');
    this.assertBookable(order);
    this.dali.assertConfigured();
    try {
      const quote = await this.dali.quote(
        { lat: dto.pickup.lat, lng: dto.pickup.lng },
        { lat: dto.dropoff.lat, lng: dto.dropoff.lng },
      );
      return {
        fee: quote.fee,
        currency: quote.currency,
        distanceM: quote.distance_m,
        zoneId: quote.zone_id,
        zoneName: quote.zone_name,
        expiresAt: quote.expires_at,
      };
    } catch (err) {
      this.throwDali(err);
    }
  }

  /** Books a rider. The fee comes out of the prepaid Dali balance, not the order total. */
  async bookForOrder(user: User, orderId: string, dto: CreateDeliveryDto) {
    const order = await this.orderFor(user, orderId, 'manage');
    this.assertBookable(order);
    this.dali.assertConfigured();

    const repo = this.dataSource.getRepository(LogisticsDelivery);
    const active = await repo.findOne({ where: { orderId, status: In(ACTIVE_STATUSES) } });
    if (active) throw new ConflictException('A rider is already booked for this order.');
    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED) {
      throw new ConflictException('This order has already been delivered.');
    }

    const attempts = await repo.count({ where: { orderId } });
    const attempt = attempts + 1;
    const externalReference = attempt === 1 ? order.reference : `${order.reference}-D${attempt}`;
    const pickup = normalizeStop(dto.pickup);
    const dropoff = normalizeStop(dto.dropoff);

    let created: DaliDelivery;
    try {
      created = await this.dali.createDelivery({
        externalReference,
        pickup,
        dropoff,
        packageCount: dto.packageCount ?? 1,
        notes: dto.notes?.trim() || undefined,
        metadata: { ipile_order_id: order.id, ipile_order_reference: order.reference },
        idempotencyKey: `ipile-${order.id}-delivery-${attempt}`,
      });
    } catch (err) {
      this.throwDali(err);
    }

    const delivery = repo.create({
      orderId,
      externalReference,
      daliId: created.id,
      status: toStatus(created.status) ?? LogisticsStatus.PENDING,
      livemode: created.livemode,
      fee: created.fee,
      currency: created.currency || 'NGN',
      distanceM: created.distance_m ?? null,
      deliveryPin: created.delivery_pin ?? null,
      runner: toRunner(created.runner),
      pickup,
      dropoff,
      packageCount: dto.packageCount ?? 1,
      notes: dto.notes?.trim() || null,
      lastSyncedAt: new Date(),
    });

    try {
      await repo.save(delivery);
    } catch {
      // Two concurrent requests book the same job thanks to the idempotency key; keep the first row.
      const existing = await repo.findOne({ where: { orderId } });
      if (existing) return this.toView(existing, this.viewerOf(user, order));
      throw new ConflictException('This delivery was already booked. Refresh the order to see it.');
    }

    await this.orders.recordCourierEvent(
      orderId,
      'courier_booked',
      `Dali rider booked — ${naira(delivery.fee)}`,
      { deliveryId: delivery.id, daliId: delivery.daliId, fee: delivery.fee },
    );

    await this.notifications.notify(order.customerId, {
      type: 'courier_booked',
      title: `A Dali rider is being assigned · ${order.reference}`,
      body: delivery.deliveryPin
        ? `Your delivery PIN is ${delivery.deliveryPin}. Share it with the rider at the door — they can't hand over without it.`
        : 'We will send you the rider details and your delivery PIN as soon as one is assigned.',
      link: `/orders/${order.id}`,
      orderId: order.id,
    });

    return this.toView(delivery, this.viewerOf(user, order));
  }

  /** Cancels before pickup; Dali refunds the fee to the prepaid balance. */
  async cancelForOrder(user: User, orderId: string, reason?: string) {
    const order = await this.orderFor(user, orderId, 'manage');
    this.dali.assertConfigured();
    const repo = this.dataSource.getRepository(LogisticsDelivery);
    const delivery = await repo.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
    if (!delivery) throw new NotFoundException('There is no rider booking for this order.');
    if (!ACTIVE_STATUSES.includes(delivery.status) || delivery.status === LogisticsStatus.PICKED_UP || delivery.status === LogisticsStatus.IN_TRANSIT) {
      throw new ConflictException('This delivery can no longer be cancelled — the rider may already have the package.');
    }

    if (delivery.daliId) {
      try {
        await this.dali.cancelDelivery(delivery.daliId, reason?.trim() || undefined);
      } catch (err) {
        this.throwDali(err);
      }
    }

    delivery.status = LogisticsStatus.CANCELLED;
    delivery.cancelledAt = new Date();
    delivery.cancelReason = reason?.trim() || 'Cancelled by the artisan';
    delivery.lastSyncedAt = new Date();
    await repo.save(delivery);

    await this.orders.recordCourierEvent(orderId, 'courier_cancelled', `Dali rider booking cancelled — ${delivery.cancelReason}`, {
      deliveryId: delivery.id,
    });
    await this.notifications.notify(order.customerId, {
      type: 'courier_cancelled',
      title: `Rider booking cancelled · ${order.reference}`,
      body: 'The artisan cancelled the Dali rider. They will arrange another handover or contact you.',
      link: `/orders/${order.id}`,
      orderId: order.id,
    });
    return this.toView(delivery, this.viewerOf(user, order));
  }

  // ───────────────────────── Webhooks ─────────────────────────

  /**
   * Stores and applies one Dali event. The event id is unique, so Dali's retries and
   * duplicate deliveries are acknowledged without notifying twice.
   */
  async handleWebhook(event: DaliWebhookEvent): Promise<{ received: true; duplicate?: boolean; matched?: boolean }> {
    if (!event.id || !event.type) throw new BadRequestException('Malformed Dali webhook.');
    if (event.type === 'ping') return { received: true };

    const eventRepo = this.dataSource.getRepository(LogisticsWebhookEvent);
    if (await eventRepo.exists({ where: { eventId: event.id } })) return { received: true, duplicate: true };

    const data = event.data ?? {};
    const nextStatus = toStatus(data.status) ?? EVENT_STATUS[event.type];
    let delivery: LogisticsDelivery | null = null;
    let previousStatus: LogisticsStatus | null = null;

    await this.dataSource.transaction(async (em) => {
      const record = em.create(LogisticsWebhookEvent, {
        eventId: event.id,
        type: event.type,
        jobId: data.job_id ?? null,
        livemode: event.livemode ?? true,
        payload: event as unknown as Record<string, unknown>,
      });
      // Reserve the id first: a concurrent duplicate loses here and is acknowledged.
      await em.save(record);

      delivery = await em.getRepository(LogisticsDelivery).findOne({
        where: [{ daliId: data.job_id ?? '' }, { externalReference: data.external_reference ?? '' }],
        order: { createdAt: 'DESC' },
      });
      if (!delivery) {
        record.error = 'No IPILE order matches this job.';
        record.processedAt = new Date();
        await em.save(record);
        return;
      }

      previousStatus = delivery.status;
      if (nextStatus) delivery.status = nextStatus;
      if (data.runner !== undefined) delivery.runner = toRunner(data.runner);
      if (event.type === 'delivery.unassigned') delivery.runner = null;
      if (typeof data.fee === 'number') delivery.fee = data.fee;
      if (typeof data.currency === 'string') delivery.currency = data.currency;

      const stamp = TIMESTAMP_COLUMNS[delivery.status];
      if (stamp && !delivery[stamp]) (delivery as unknown as Record<string, unknown>)[stamp] = new Date();
      if (data.status === LogisticsStatus.DELIVERED) delivery.deliveredAt ??= new Date();
      if (data.status === LogisticsStatus.COMPLETED) delivery.completedAt ??= new Date();
      delivery.lastSyncedAt = new Date();
      await em.save(delivery);

      record.deliveryId = delivery.id;
      record.processedAt = new Date();
      await em.save(record);
    });

    if (!delivery) {
      this.logger.warn(`Dali event ${event.id} (${event.type}) does not match an IPILE delivery.`);
      return { received: true, matched: false };
    }

    const saved = delivery as LogisticsDelivery;
    await this.afterEvent(saved, event, previousStatus);
    return { received: true, matched: true };
  }

  private async afterEvent(delivery: LogisticsDelivery, event: DaliWebhookEvent, previousStatus: LogisticsStatus | null) {
    const order = await this.order(delivery.orderId);
    if (!order) return;
    const runnerName = delivery.runner?.name ?? null;
    const pinLine = delivery.deliveryPin ? ` Delivery PIN: ${delivery.deliveryPin}.` : '';

    // Out-of-order events may repeat a status; only announce real transitions.
    const changed = previousStatus !== delivery.status || event.type === 'delivery.assigned';
    if (changed) {
      if (delivery.status === LogisticsStatus.ASSIGNED) {
        const runner = delivery.runner;
        await this.notifications.notify(order.customerId, {
          type: 'courier_assigned',
          title: `Your rider is on the way · ${order.reference}`,
          body: runner
            ? `${runner.name} (${runner.vehicle}${runner.rating ? `, ${runner.rating}★` : ''}) — ${runner.phone}.${pinLine}`
            : `A Dali rider has been assigned to collect your piece.${pinLine}`,
          link: `/orders/${order.id}`,
          orderId: order.id,
        });
      } else if (delivery.status === LogisticsStatus.PICKED_UP) {
        await this.notifications.notify(order.customerId, {
          type: 'courier_picked_up',
          title: `Your piece is with the rider · ${order.reference}`,
          body: 'The Dali rider has collected your order and is heading your way. Have your delivery PIN ready.',
          link: `/orders/${order.id}`,
          orderId: order.id,
        });
      } else if (delivery.status === LogisticsStatus.IN_TRANSIT) {
        await this.notifications.notify(order.customerId, {
          type: 'courier_in_transit',
          title: `Your delivery is on the way · ${order.reference}`,
          body: 'The Dali rider is on the way to your address. Keep your phone close and your delivery PIN ready.',
          link: `/orders/${order.id}`,
          orderId: order.id,
        });
      } else if (delivery.status === LogisticsStatus.CANCELLED) {
        await this.notifications.notify(order.customerId, {
          type: 'courier_cancelled',
          title: `Rider booking cancelled · ${order.reference}`,
          body: 'The Dali rider booking was cancelled. Your artisan will arrange another handover or contact you.',
          link: `/orders/${order.id}`,
          orderId: order.id,
        });
      } else if (delivery.status === LogisticsStatus.FAILED) {
        await this.notifications.notify(order.customerId, {
          type: 'courier_failed',
          title: `Delivery problem · ${order.reference}`,
          body: 'Dali could not complete this delivery. Their support team will contact you, and IPILE can help too.',
          link: `/orders/${order.id}`,
          orderId: order.id,
        });
        await this.notifications.notifyAdmins({
          type: 'admin_courier_failed',
          title: `Dali delivery failed · ${order.reference}`,
          body: `The rider could not deliver order ${order.reference}. Dali support has been notified.`,
          link: `/admin/orders/${order.id}`,
          orderId: order.id,
        });
      } else if (delivery.status === LogisticsStatus.DISPUTED) {
        await this.notifications.notifyAdmins({
          type: 'admin_courier_disputed',
          title: `Dali delivery disputed · ${order.reference}`,
          body: `Dali opened a review on order ${order.reference}.`,
          link: `/admin/orders/${order.id}`,
          orderId: order.id,
        });
      }
    }

    if (delivery.status === LogisticsStatus.DELIVERED || delivery.status === LogisticsStatus.COMPLETED) {
      try {
        await this.orders.markDeliveredByCourier(order.id, {
          deliveryId: delivery.id,
          runnerName,
          externalReference: delivery.externalReference,
        });
      } catch (err) {
        this.logger.error(`Dali says order ${order.reference} was delivered, but marking it failed`, err as Error);
      }
    }

    // Keep the order timeline in step with the rider, without changing order status.
    if (changed && delivery.status !== LogisticsStatus.DELIVERED && delivery.status !== LogisticsStatus.COMPLETED) {
      await this.orders
        .recordCourierEvent(order.id, 'courier_update', `Dali delivery: ${statusLabel[delivery.status]}`, {
          deliveryId: delivery.id,
          status: delivery.status,
        })
        .catch((err: unknown) => this.logger.error(`Could not record Dali update for ${order.reference}`, err as Error));
    }
  }

  // ───────────────────────── Admin ─────────────────────────

  account() {
    this.dali.assertConfigured();
    return this.dali.account().catch((err: unknown) => this.throwDali(err));
  }

  async testWebhook() {
    this.dali.assertConfigured();
    return this.dali.testWebhook().catch((err: unknown) => this.throwDali(err));
  }

  /** Test keys only. Applies Dali's returned state locally so the order UI moves immediately. */
  async simulateForAdmin(deliveryId: string, status: LogisticsStatus) {
    this.dali.assertConfigured();
    const repo = this.dataSource.getRepository(LogisticsDelivery);
    const delivery = await repo.findOne({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException('Delivery not found.');
    if (!delivery.daliId) throw new ConflictException('This delivery has no Dali job id.');
    if (delivery.livemode) throw new ConflictException('Simulation only works for test-key deliveries.');

    let updated: DaliDelivery;
    try {
      updated = await this.dali.simulate(delivery.daliId, status);
    } catch (err) {
      this.throwDali(err);
    }
    const previous = delivery.status;
    delivery.status = toStatus(updated.status) ?? status;
    delivery.runner = toRunner(updated.runner) ?? delivery.runner;
    const stamp = TIMESTAMP_COLUMNS[delivery.status];
    if (stamp && !delivery[stamp]) (delivery as unknown as Record<string, unknown>)[stamp] = new Date();
    delivery.lastSyncedAt = new Date();
    await repo.save(delivery);

    await this.afterEvent(
      delivery,
      {
        id: `admin-simulate-${delivery.id}-${Date.now()}`,
        type: `delivery.${delivery.status}`,
        livemode: false,
        data: { job_id: delivery.daliId, external_reference: delivery.externalReference, status: delivery.status },
      },
      previous,
    );
    return this.toView(delivery, 'admin');
  }

  async listForAdmin(query: { status?: LogisticsStatus; page?: number; limit?: number } = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const repo = this.dataSource.getRepository(LogisticsDelivery);
    const [rows, total] = await repo.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const orders = orderIds.length
      ? await this.dataSource.getRepository(Order).find({
          where: { id: In(orderIds) },
          select: { id: true, reference: true, status: true, garmentType: true, customerId: true },
        })
      : [];
    const customers = await this.userNames(orders.map((o) => o.customerId));
    return {
      items: rows.map((row) => {
        const order = orders.find((o) => o.id === row.orderId) ?? null;
        return {
          ...this.toView(row, 'admin'),
          order: order
            ? {
                id: order.id,
                reference: order.reference,
                status: order.status,
                garmentType: order.garmentType,
                customerName: customers.get(order.customerId) ?? null,
              }
            : null,
        };
      }),
      total,
      page,
      limit,
    };
  }

  // ───────────────────────── Internals ─────────────────────────

  private async orderFor(user: User, orderId: string, capability: 'view' | 'manage'): Promise<Order> {
    const order = await this.order(orderId);
    if (!order) throw new NotFoundException('Order not found.');
    const admin = user.role === UserRole.ADMIN;
    const participant = order.customerId === user.id || order.tailorUserId === user.id;
    if (!admin) {
      if (capability === 'manage' && order.tailorUserId !== user.id) throw new NotFoundException('Order not found.');
      if (capability === 'view' && !participant) throw new NotFoundException('Order not found.');
    }
    return order;
  }

  private order(orderId: string) {
    return this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
  }

  private latestForOrder(orderId: string) {
    return this.dataSource.getRepository(LogisticsDelivery).findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  private viewerOf(user: User, order: Order): Viewer {
    if (user.role === UserRole.ADMIN) return 'admin';
    if (order.customerId === user.id) return 'customer';
    return 'tailor';
  }

  private assertBookable(order: Order) {
    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.IN_PROGRESS) {
      throw new ConflictException('A rider can only be booked for a paid order that is still being made.');
    }
    if (order.milestone !== OrderMilestone.DELIVERY) {
      throw new BadRequestException('Move the order to the handover stage before booking a rider.');
    }
  }

  private toView(delivery: LogisticsDelivery, viewer: Viewer) {
    return {
      id: delivery.id,
      orderId: delivery.orderId,
      daliId: delivery.daliId,
      externalReference: delivery.externalReference,
      status: delivery.status,
      livemode: delivery.livemode,
      fee: delivery.fee,
      currency: delivery.currency,
      distanceM: delivery.distanceM,
      // The PIN belongs to the customer; the artisan and merchant never see it.
      deliveryPin: viewer === 'customer' || viewer === 'admin' ? delivery.deliveryPin : null,
      runner: delivery.runner,
      pickup: delivery.pickup,
      dropoff: delivery.dropoff,
      packageCount: delivery.packageCount,
      notes: delivery.notes,
      cancelReason: delivery.cancelReason,
      lastError: delivery.lastError,
      timestamps: {
        assignedAt: delivery.assignedAt,
        pickedUpAt: delivery.pickedUpAt,
        deliveredAt: delivery.deliveredAt,
        completedAt: delivery.completedAt,
        cancelledAt: delivery.cancelledAt,
        failedAt: delivery.failedAt,
        lastSyncedAt: delivery.lastSyncedAt,
      },
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      canCancel:
        (viewer === 'tailor' || viewer === 'admin') &&
        ACTIVE_STATUSES.includes(delivery.status) &&
        delivery.status !== LogisticsStatus.PICKED_UP &&
        delivery.status !== LogisticsStatus.IN_TRANSIT,
    };
  }

  private async userNames(ids: string[]) {
    const unique = [...new Set(ids)];
    const map = new Map<string, string | null>();
    if (!unique.length) return map;
    const rows = await this.dataSource.getRepository(User).find({ where: { id: In(unique) }, select: { id: true, fullName: true } });
    for (const row of rows) map.set(row.id, row.fullName ?? null);
    return map;
  }

  /** Maps Dali's failure codes to HTTP exceptions with a message people can act on. */
  private throwDali(err: unknown): never {
    if (!(err instanceof DaliError)) throw err;
    const message = err.message;
    switch (err.status) {
      case 400:
      case 422:
        throw new BadRequestException(message);
      case 401:
      case 403:
        this.logger.error(`Dali authorisation failed: ${err.code ?? ''} ${message}`);
        throw new ForbiddenException('Rider delivery is not configured correctly. Please contact IPILE support.');
      case 402:
        this.logger.error(`Dali balance is insufficient: ${message}`);
        throw new BadGatewayException('Rider delivery is temporarily unavailable — the delivery account needs a top-up.');
      case 404:
        throw new NotFoundException(message);
      case 409:
        throw new ConflictException(message);
      case 429:
        throw new HttpException(message || 'Too many delivery requests. Please try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
      default:
        throw new BadGatewayException('Dali Logistics is unavailable right now. Please try again.');
    }
  }
}

function normalizeStop(stop: DeliveryStopDto): LogisticsStop {
  return {
    lat: stop.lat,
    lng: stop.lng,
    ...(stop.label?.trim() ? { label: stop.label.trim() } : {}),
    address: stop.address.trim(),
    contact_name: stop.contactName.trim(),
    contact_phone: stop.contactPhone.trim(),
  } as LogisticsStop;
}

function toRunner(runner: DaliRunner | null | undefined): LogisticsRunner | null {
  if (!runner) return null;
  return {
    name: runner.name,
    phone: runner.phone,
    vehicle: runner.vehicle,
    rating: runner.rating ?? null,
  };
}

function toStatus(value: string | undefined | null): LogisticsStatus | null {
  return value && (Object.values(LogisticsStatus) as string[]).includes(value) ? (value as LogisticsStatus) : null;
}

function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}
