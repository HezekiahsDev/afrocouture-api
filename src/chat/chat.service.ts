import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LessThan, Repository } from 'typeorm';
import type { Namespace } from 'socket.io';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity.js';
import { Order, OrderMilestone, OrderStatus } from '../orders/entities/order.entity.js';

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

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  /** Set by ChatGateway once the /chat namespace is ready, so REST sends reach live sockets too. */
  private server: Namespace | null = null;

  constructor(
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
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
    return message;
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
