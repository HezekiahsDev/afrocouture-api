import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LessThan, Repository } from 'typeorm';
import type { Namespace } from 'socket.io';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity.js';
import { Order, OrderMilestone, OrderStatus } from '../orders/entities/order.entity.js';
import { User } from '../users/entities/user.entity.js';
import {
  NOTIFICATION_CREATED,
  NotificationsService,
  type NotificationCreatedEvent,
} from '../notifications/notifications.service.js';

/** Payload of the in-process 'order.event' emitted by OrdersService (see docs/orders-payments-ai-contract.md). */
export interface OrderEventPayload {
  orderId: string;
  type: string;
  label: string;
  status: OrderStatus;
  milestone: OrderMilestone;
  actorUserId: string | null;
}

/** Orders where the conversation is closed for new messages. */
const CLOSED: OrderStatus[] = [OrderStatus.DECLINED, OrderStatus.CANCELLED];
const MAX_LENGTH = 2000;
const MAX_PAGE = 100;

export const roomFor = (orderId: string) => `order:${orderId}`;
/** Every socket joins its user's room so notifications reach all of that person's open tabs. */
export const userRoom = (userId: string) => `user:${userId}`;
/** In-process event: `{ userId }` — emit it whenever an account's status leaves 'active'. */
export const USER_SUSPENDED = 'user.suspended';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  /** Set by ChatGateway once the /chat namespace is ready, so REST sends reach live sockets too. */
  private server: Namespace | null = null;

  constructor(
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  attachServer(server: Namespace) {
    this.server = server;
  }

  /** The order, if this user is its customer or tailor; otherwise 404/403. */
  async requireMember(orderId: string, userId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== userId && order.tailorUserId !== userId) {
      throw new ForbiddenException('Only the customer and tailor on this order can use its chat.');
    }
    return order;
  }

  async list(
    orderId: string,
    userId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<ChatMessage[]> {
    await this.requireMember(orderId, userId);
    return this.page(orderId, opts);
  }

  /** Read-only view of an order's conversation for admins resolving a dispute (they never join it). */
  async listForAdmin(orderId: string, opts: { before?: string; limit?: number } = {}): Promise<ChatMessage[]> {
    if (!(await this.orders.exists({ where: { id: orderId } }))) throw new NotFoundException('Order not found.');
    return this.page(orderId, opts);
  }

  private async page(orderId: string, opts: { before?: string; limit?: number }): Promise<ChatMessage[]> {
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), MAX_PAGE);
    let before: Date | undefined;
    if (opts.before) {
      before = new Date(opts.before);
      if (Number.isNaN(before.getTime())) throw new BadRequestException('`before` must be an ISO date.');
    }

    const page = await this.messages.find({
      where: { orderId, ...(before ? { createdAt: LessThan(before) } : {}) },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return page.reverse();
  }

  async send(
    orderId: string,
    userId: string,
    input: { content?: string; attachmentUrl?: string },
  ): Promise<ChatMessage> {
    const order = await this.requireMember(orderId, userId);
    if (CLOSED.includes(order.status)) {
      throw new ForbiddenException(`This order was ${order.status}, so its chat is closed.`);
    }

    const content = (input.content ?? '').trim();
    const attachmentUrl = input.attachmentUrl?.trim() || null;
    if (attachmentUrl && !/^https:\/\//i.test(attachmentUrl)) {
      throw new BadRequestException('Attachments must be https links.');
    }
    if (!content && !attachmentUrl) throw new BadRequestException('Write a message or attach an image.');
    if (content.length > MAX_LENGTH) {
      throw new BadRequestException(`Messages can be at most ${MAX_LENGTH} characters.`);
    }

    const message = await this.messages.save(
      this.messages.create({
        orderId,
        senderId: userId,
        type: attachmentUrl ? ChatMessageType.IMAGE : ChatMessageType.TEXT,
        content,
        attachmentUrl,
      }),
    );
    this.broadcast(orderId, 'new_message', message);
    void this.notifyRecipient(order, userId, content);
    return message;
  }

  /** Tells the other party about a message, unless they have this chat open right now. */
  private async notifyRecipient(order: Order, senderId: string, content: string) {
    const recipientId = senderId === order.customerId ? order.tailorUserId : order.customerId;
    try {
      const watching = (await this.server?.in(roomFor(order.id)).fetchSockets())?.some(
        (s) => (s.data as { user?: User } | undefined)?.user?.id === recipientId,
      );
      if (watching) return;
      const sender = await this.users.findOne({ where: { id: senderId }, select: { id: true, fullName: true } });
      const who = sender?.fullName?.split(' ')[0] || (senderId === order.customerId ? 'Your customer' : 'Your artisan');
      await this.notifications.notifyChat(recipientId, order.id, {
        title: `New message from ${who} · ${order.reference}`,
        body: content || 'Sent an image',
        link: `/orders/${order.id}`,
      });
    } catch (err) {
      this.logger.error(`Could not notify about a message on order ${order.id}`, err as Error);
    }
  }

  /** Emitted when an admin suspends an account: close every socket that person has open. */
  @OnEvent(USER_SUSPENDED)
  disconnectUser({ userId }: { userId: string }): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Pushes a new notification and the updated unread count to the person's open tabs. */
  @OnEvent(NOTIFICATION_CREATED)
  pushNotification({ notification, unreadCount }: NotificationCreatedEvent): void {
    this.server?.to(userRoom(notification.userId)).emit('notification', { notification, unreadCount });
  }

  async postSystem(orderId: string, label: string): Promise<ChatMessage> {
    const message = await this.messages.save(
      this.messages.create({ orderId, senderId: null, type: ChatMessageType.SYSTEM, content: label }),
    );
    this.broadcast(orderId, 'new_message', message);
    return message;
  }

  /** Mirrors every recorded order event into the chat as a system message. */
  @OnEvent('order.event', { async: true, promisify: true })
  async handleOrderEvent(event: OrderEventPayload): Promise<void> {
    try {
      const exists = await this.orders.exists({ where: { id: event.orderId } });
      if (!exists) {
        this.logger.warn(`order.event for missing order ${event.orderId} ignored`);
        return;
      }
      await this.postSystem(event.orderId, event.label);
      this.broadcast(event.orderId, 'order_updated', {
        orderId: event.orderId,
        status: event.status,
        milestone: event.milestone,
      });
    } catch (err) {
      // Never let chat failures break the order flow that emitted the event.
      this.logger.error(`Could not post system message for order ${event.orderId}`, err as Error);
    }
  }

  private broadcast(orderId: string, event: string, payload: unknown) {
    this.server?.to(roomFor(orderId)).emit(event, payload);
  }
}
