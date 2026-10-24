import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity.js';
import { Order, OrderMilestone, OrderStatus } from '../orders/entities/order.entity.js';

const CUSTOMER = 'c0000000-0000-4000-8000-000000000001';
const TAILOR = 't0000000-0000-4000-8000-000000000002';
const STRANGER = 's0000000-0000-4000-8000-000000000003';
const ORDER = 'o0000000-0000-4000-8000-000000000004';

function setup(status: OrderStatus = OrderStatus.PAID, orderExists = true) {
  const saved: ChatMessage[] = [];
  const order = { id: ORDER, customerId: CUSTOMER, tailorUserId: TAILOR, status } as Order;
  const orders = {
    findOne: vi.fn(async () => (orderExists ? order : null)),
    exists: vi.fn(async () => orderExists),
  };
  const messages = {
    create: vi.fn((data: Partial<ChatMessage>) => ({ ...data }) as ChatMessage),
    save: vi.fn(async (m: ChatMessage) => {
      const row = Object.assign(m, { id: `m${saved.length + 1}`, createdAt: new Date() });
      saved.push(row);
      return row;
    }),
    find: vi.fn(async () => [{ id: 'm2' }, { id: 'm1' }] as ChatMessage[]),
  };
  const emit = vi.fn();
  const server = { to: vi.fn(() => ({ emit })) };
  const service = new ChatService(messages as any, orders as any);
  service.attachServer(server as any);
  return { service, saved, messages, orders, server, emit };
}

describe('ChatService', () => {
  describe('membership', () => {
    it('lets the customer and the tailor in', async () => {
      const { service } = setup();
      await expect(service.requireMember(ORDER, CUSTOMER)).resolves.toMatchObject({ id: ORDER });
      await expect(service.requireMember(ORDER, TAILOR)).resolves.toMatchObject({ id: ORDER });
    });

    it('rejects anyone else', async () => {
      const { service } = setup();
      await expect(service.requireMember(ORDER, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.send(ORDER, STRANGER, { content: 'hi' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.list(ORDER, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s for an unknown order', async () => {
      const { service } = setup(OrderStatus.PAID, false);
      await expect(service.requireMember(ORDER, CUSTOMER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('send', () => {
    it('saves trimmed text and broadcasts it to the order room', async () => {
      const { service, server, emit } = setup();
      const message = await service.send(ORDER, CUSTOMER, { content: '  Hello there  ' });
      expect(message).toMatchObject({ content: 'Hello there', type: ChatMessageType.TEXT, senderId: CUSTOMER });
      expect(server.to).toHaveBeenCalledWith(`order:${ORDER}`);
      expect(emit).toHaveBeenCalledWith('new_message', message);
    });

    it('marks attachments as images and allows an empty caption', async () => {
      const { service } = setup();
      const message = await service.send(ORDER, TAILOR, { attachmentUrl: 'https://res.cloudinary.com/x/a.jpg' });
      expect(message).toMatchObject({ type: ChatMessageType.IMAGE, content: '' });
    });

    it('rejects empty, over-long and non-https messages', async () => {
      const { service } = setup();
      await expect(service.send(ORDER, CUSTOMER, { content: '   ' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.send(ORDER, CUSTOMER, { content: 'x'.repeat(2001) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.send(ORDER, CUSTOMER, { attachmentUrl: 'http://example.com/a.jpg' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([OrderStatus.DECLINED, OrderStatus.CANCELLED])('is closed once the order is %s', async (status) => {
      const { service } = setup(status);
      await expect(service.send(ORDER, CUSTOMER, { content: 'hi' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('returns the page oldest first and caps the limit', async () => {
      const { service, messages } = setup();
      const page = await service.list(ORDER, CUSTOMER, { limit: 500 });
      expect(page.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(messages.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });

    it('rejects a malformed cursor', async () => {
      const { service } = setup();
      await expect(service.list(ORDER, CUSTOMER, { before: 'yesterday' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('order.event', () => {
    const event = {
      orderId: ORDER,
      type: 'milestone',
      label: 'Cutting has started',
      status: OrderStatus.IN_PROGRESS,
      milestone: OrderMilestone.CUTTING,
      actorUserId: TAILOR,
    };

    it('posts a system message and tells the room the order changed', async () => {
      const { service, saved, emit } = setup();
      await service.handleOrderEvent(event);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ type: ChatMessageType.SYSTEM, senderId: null, content: 'Cutting has started' });
      expect(emit).toHaveBeenCalledWith('new_message', saved[0]);
      expect(emit).toHaveBeenCalledWith('order_updated', {
        orderId: ORDER,
        status: OrderStatus.IN_PROGRESS,
        milestone: OrderMilestone.CUTTING,
      });
    });

    it('ignores events for orders that no longer exist', async () => {
      const { service, saved } = setup(OrderStatus.PAID, false);
      await expect(service.handleOrderEvent(event)).resolves.toBeUndefined();
      expect(saved).toHaveLength(0);
    });

    it('never throws back into the order flow', async () => {
      const { service, messages } = setup();
      messages.save.mockRejectedValueOnce(new Error('db down'));
      await expect(service.handleOrderEvent(event)).resolves.toBeUndefined();
    });
  });
});
