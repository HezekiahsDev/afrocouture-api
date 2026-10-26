import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service.js';
import { AdminFabricsService } from './admin-fabrics.service.js';
import { AuditService } from './audit/audit.service.js';
import { USER_SUSPENDED } from '../chat/chat.service.js';
import { UserRole } from '../types/index.js';
import type { User } from '../users/entities/user.entity.js';
import type { Fabric } from '../fabrics/entities/fabric.entity.js';

const ADMIN = { id: 'admin-1', role: UserRole.ADMIN } as User;

describe('AdminUsersService', () => {
  function setup(target: Partial<User> | null) {
    const repo = {
      findOne: vi.fn(async () => target as User | null),
      update: vi.fn(async () => ({ affected: 1 })),
      findOneOrFail: vi.fn(async () => ({ ...target, status: 'suspended' }) as User),
    };
    const db = { getRepository: vi.fn(() => repo), query: vi.fn(async () => [{ id: target?.id, n: '2' }]) };
    const mail = { sendMail: vi.fn(async () => ({})) };
    const events = { emit: vi.fn() };
    const config = { get: vi.fn(() => '+234 810 668 1869') };
    const service = new AdminUsersService(db as any, mail as any, events as any, config as any);
    return { service, repo, mail, events };
  }

  it('suspends: status, reason, revoked refresh token, sockets closed, email sent', async () => {
    const { service, repo, events, mail } = setup({ id: 'u1', email: 'kemi@x.test', role: UserRole.CUSTOMER, status: 'active' });
    const row = await service.suspend(ADMIN, 'u1', '  Repeated chargebacks ');
    expect(repo.update).toHaveBeenCalledWith('u1', expect.objectContaining({
      status: 'suspended', suspensionReason: 'Repeated chargebacks', refreshTokenHash: null, suspendedAt: expect.any(Date),
    }));
    expect(events.emit).toHaveBeenCalledWith(USER_SUSPENDED, { userId: 'u1' });
    await new Promise((r) => setImmediate(r));
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'kemi@x.test', text: expect.stringContaining('https://wa.me/2348106681869') }));
    expect(row).toMatchObject({ id: 'u1', status: 'suspended', orderCount: 2 });
  });

  it('refuses self, other admins, and repeat suspensions', async () => {
    await expect(setup({ id: 'admin-1', role: UserRole.ADMIN }).service.suspend(ADMIN, 'admin-1', 'x'.repeat(5))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ id: 'a2', role: UserRole.ADMIN }).service.suspend(ADMIN, 'a2', 'x'.repeat(5))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ id: 'u1', role: UserRole.CUSTOMER, status: 'suspended' }).service.suspend(ADMIN, 'u1', 'x'.repeat(5))).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ id: 'u1', role: UserRole.CUSTOMER, status: 'active' }).service.reactivate(ADMIN, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('still suspends when the email fails', async () => {
    const { service, mail, repo } = setup({ id: 'u1', email: 'kemi@x.test', role: UserRole.CUSTOMER, status: 'active' });
    mail.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.suspend(ADMIN, 'u1', 'Fraudulent orders')).resolves.toMatchObject({ status: 'suspended' });
    expect(repo.update).toHaveBeenCalled();
  });
});

describe('AdminFabricsService.moderate', () => {
  function setup(fabric: Partial<Fabric>) {
    const row = { id: 'f1', name: 'Indigo Adire', merchant: { id: 'm1', userId: 'mu1', businessName: 'Bola', verificationStatus: 'approved' }, ...fabric } as Fabric;
    const repo = { findOne: vi.fn(async () => row), save: vi.fn(async (f: Fabric) => f) };
    const notifications = { notify: vi.fn(async () => undefined) };
    return { service: new AdminFabricsService(repo as any, notifications as any), notifications, row };
  }

  it('unpublishing locks the listing and notifies the merchant', async () => {
    const { service, notifications } = setup({ isPublished: true, moderatedAt: null });
    const { fabric, changed } = await service.moderate('f1', { isPublished: false, note: ' Wrong photos ' });
    expect(changed).toBe(true);
    expect(fabric).toMatchObject({ isPublished: false, unpublishedReason: 'Wrong photos', moderatedAt: expect.any(Date) });
    expect(notifications.notify).toHaveBeenCalledWith('mu1', expect.objectContaining({ type: 'fabric_moderation', link: '/merchant/fabrics/f1' }));
  });

  it('locks a listing the merchant had already unpublished', async () => {
    const { service } = setup({ isPublished: false, moderatedAt: null });
    expect((await service.moderate('f1', { isPublished: false, note: 'Counterfeit' })).changed).toBe(true);
  });

  it('republishing clears the lock; a no-op change sends nothing', async () => {
    const { service, notifications } = setup({ isPublished: false, moderatedAt: new Date(), unpublishedReason: 'x' });
    const { fabric } = await service.moderate('f1', { isPublished: true });
    expect(fabric).toMatchObject({ isPublished: true, moderatedAt: null, unpublishedReason: null });
    const again = setup({ isPublished: true, moderatedAt: null });
    expect((await again.service.moderate('f1', { isPublished: true })).changed).toBe(false);
    expect(again.notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
});

describe('AuditService.record', () => {
  it('never throws', async () => {
    const log = { create: vi.fn((x) => x), save: vi.fn(async () => { throw new Error('db down'); }) };
    const service = new AuditService(log as any, {} as any);
    await expect(service.record(ADMIN, { action: 'user.suspend', targetType: 'user', targetId: 'u1', summary: 'x' })).resolves.toBeUndefined();
  });
});
