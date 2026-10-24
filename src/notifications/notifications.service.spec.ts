import { IsNull } from 'typeorm';
import { NotificationsService, NOTIFICATION_CREATED } from './notifications.service.js';
import type { Notification } from './entities/notification.entity.js';

const USER = 'u0000000-0000-4000-8000-000000000001';
const ORDER = 'o0000000-0000-4000-8000-000000000002';

function setup(existingUnreadChat: Partial<Notification> | null = null) {
  const repo = {
    create: vi.fn((data: Partial<Notification>) => ({ ...data }) as Notification),
    save: vi.fn(async (n: Notification | Notification[]) => {
      const stamp = (x: Notification, i = 0) => Object.assign(x, { id: x.id ?? `n${i + 1}`, createdAt: x.createdAt ?? new Date() });
      return Array.isArray(n) ? n.map(stamp) : stamp(n);
    }),
    findOne: vi.fn(async () => existingUnreadChat as Notification | null),
    count: vi.fn(async () => 2),
    update: vi.fn(async () => ({ affected: 1 })),
    delete: vi.fn(async () => ({ affected: 4 })),
  };
  const users = { find: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]) };
  const events = { emit: vi.fn() };
  const service = new NotificationsService(repo as any, users as any, events as any, { addInterval: vi.fn() } as any);
  return { service, repo, users, events };
}

describe('NotificationsService', () => {
  it('saves a notification and announces it with the unread count', async () => {
    const { service, repo, events } = setup();
    await service.notify(USER, { type: 'order_quoted', title: 'Your quote is ready', body: 'x'.repeat(400), link: '/orders/1' });
    const saved = repo.save.mock.calls[0][0] as Notification;
    expect(saved).toMatchObject({ userId: USER, type: 'order_quoted', link: '/orders/1', orderId: null });
    expect(saved.body).toHaveLength(280);
    expect(events.emit).toHaveBeenCalledWith(NOTIFICATION_CREATED, expect.objectContaining({ unreadCount: 2 }));
  });

  it('ignores a missing recipient and never throws', async () => {
    const { service, repo } = setup();
    await service.notify(null, { type: 'x', title: 'y' });
    expect(repo.save).not.toHaveBeenCalled();
    repo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(service.notify(USER, { type: 'x', title: 'y' })).resolves.toBeUndefined();
  });

  it('notifies every active admin', async () => {
    const { service, repo } = setup();
    const { events } = { events: (service as unknown as { events: { emit: ReturnType<typeof vi.fn> } }).events };
    await service.notifyAdmins({ type: 'admin_dispute', title: 'Dispute opened' });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect((repo.save.mock.calls[0][0] as unknown as Notification[]).map((n) => n.userId)).toEqual(['a1', 'a2']);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('collapses chat messages into the unread notification for that order', async () => {
    const old = new Date('2026-01-01');
    const { service, repo } = setup({ id: 'n9', userId: USER, orderId: ORDER, type: 'chat', title: 'old', createdAt: old });
    await service.notifyChat(USER, ORDER, { title: 'New message from Ngozi', body: 'Fitting moved to Friday' });
    expect(repo.create).not.toHaveBeenCalled();
    const saved = repo.save.mock.calls[0][0] as Notification;
    expect(saved).toMatchObject({ id: 'n9', title: 'New message from Ngozi', body: 'Fitting moved to Friday' });
    expect(saved.createdAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('starts a new chat notification once the last one was read', async () => {
    const { service, repo } = setup(null);
    await service.notifyChat(USER, ORDER, { title: 'New message', body: 'Hi' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat', orderId: ORDER }));
  });

  it('marks read by ids, by order, or all — and nothing without a target', async () => {
    const { service, repo } = setup();
    await service.markRead(USER, { all: true });
    expect(repo.update).toHaveBeenLastCalledWith({ userId: USER, readAt: IsNull() }, expect.anything());
    await service.markRead(USER, { orderId: ORDER });
    expect(repo.update).toHaveBeenLastCalledWith({ userId: USER, orderId: ORDER, readAt: IsNull() }, expect.anything());
    repo.update.mockClear();
    await expect(service.markRead(USER, {})).resolves.toEqual({ unreadCount: 2 });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
