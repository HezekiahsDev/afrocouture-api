import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UserRole } from '../types/index.js';
import type { User } from './entities/user.entity.js';

function setup(committed: { tailor?: boolean; merchant?: boolean; orders?: boolean } = {}) {
  const users = { save: vi.fn(async (u: User) => u) };
  const exists = (flag?: boolean) => ({ exists: vi.fn(async () => Boolean(flag)) });
  const service = new UsersService(users as any, exists(committed.tailor) as any, exists(committed.merchant) as any, exists(committed.orders) as any);
  return { service, users };
}

const user = (role: UserRole) => ({ id: 'u1', role }) as User;

describe('UsersService.setRole', () => {
  it('lets a new account pick its role', async () => {
    const { service } = setup();
    await expect(service.setRole(user(UserRole.CUSTOMER), UserRole.TAILOR)).resolves.toMatchObject({ role: UserRole.TAILOR });
  });

  it('never changes an admin', async () => {
    const { service } = setup();
    await expect(service.setRole(user(UserRole.ADMIN), UserRole.CUSTOMER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([['submitted artisan profile', { tailor: true }], ['submitted merchant profile', { merchant: true }], ['orders', { orders: true }]])(
    'locks the role once the account has a %s',
    async (_label, committed) => {
      const { service, users } = setup(committed);
      await expect(service.setRole(user(UserRole.TAILOR), UserRole.MERCHANT)).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    },
  );

  it('treats choosing the current role as a no-op', async () => {
    const { service, users } = setup({ orders: true });
    await expect(service.setRole(user(UserRole.TAILOR), UserRole.TAILOR)).resolves.toMatchObject({ role: UserRole.TAILOR });
    expect(users.save).not.toHaveBeenCalled();
  });
});
