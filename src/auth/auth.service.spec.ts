import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

const config = {
  getOrThrow: (key: string) => ({ JWT_SECRET: 'access-secret', JWT_REFRESH_SECRET: 'refresh-secret' })[key]!,
  get: (_key: string, fallback?: string) => fallback,
};

/** In-memory users table covering the query shapes AuthService uses. */
function fakeUsers() {
  const rows: User[] = [];
  const byWhere = (where: Partial<User>) =>
    rows.find((u) => Object.entries(where).every(([k, v]) => (u as any)[k] === v)) ?? null;
  const qb = () => {
    let where: Partial<User> = {};
    const api = {
      addSelect: () => api,
      where: (_sql: string, params: Record<string, string>) => {
        where = params.email ? { email: params.email } : { id: params.id };
        return api;
      },
      getOne: async () => {
        const u = byWhere(where);
        return u ? Object.assign({}, u) : null;
      },
    };
    return api;
  };
  return {
    rows,
    findOne: vi.fn(async ({ where }: { where: Partial<User> }) => byWhere(where)),
    findOneByOrFail: vi.fn(async (where: Partial<User>) => byWhere(where)!),
    create: vi.fn((data: Partial<User>) => ({ role: UserRole.CUSTOMER, status: 'active', emailVerified: false, ...data }) as User),
    save: vi.fn(async (u: User) => {
      u.id ??= `user-${rows.length + 1}`;
      if (!rows.includes(u)) rows.push(u);
      return u;
    }),
    update: vi.fn(async (id: string, patch: Partial<User>) => {
      const u = rows.find((r) => r.id === id);
      if (u) Object.assign(u, patch);
    }),
    createQueryBuilder: vi.fn(qb),
  };
}

describe('AuthService', () => {
  let users: ReturnType<typeof fakeUsers>;
  let otp: {
    generateAndSend: ReturnType<typeof vi.fn>;
    sendUnlessRecent: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;

  beforeEach(() => {
    users = fakeUsers();
    otp = {
      generateAndSend: vi.fn(async () => undefined),
      sendUnlessRecent: vi.fn(async () => true),
      verify: vi.fn(async () => undefined),
    };
    const jwt = new JwtService({ secret: 'access-secret', signOptions: { expiresIn: '15m' } });
    service = new AuthService(users as any, otp as any, jwt, config as any);
  });

  async function verifiedUser(email = 'a@example.com', password = 'Needle2026') {
    await service.register({ email, password, fullName: 'Ada Obi', role: UserRole.TAILOR });
    return service.verifyEmail({ email, code: '123456' });
  }

  it('registers an unverified user, hashes the password and sends a code', async () => {
    await service.register({ email: 'a@example.com', password: 'Needle2026', fullName: ' Ada Obi ' });
    const user = users.rows[0];
    expect(user.emailVerified).toBe(false);
    expect(user.fullName).toBe('Ada Obi');
    expect(await bcrypt.compare('Needle2026', user.passwordHash!)).toBe(true);
    expect(otp.sendUnlessRecent).toHaveBeenCalledWith('a@example.com', 'signup');
  });

  it('refuses to register an email that is already verified, with a code the web app can act on', async () => {
    await verifiedUser();
    const attempt = service.register({ email: 'a@example.com', password: 'Needle2026', fullName: 'Someone' });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: { code: 'ACCOUNT_EXISTS' } });
  });

  it('lets someone who abandoned sign-up start again, even straight away', async () => {
    await service.register({ email: 'a@example.com', password: 'Needle2026', fullName: 'Ada Obi' });
    otp.sendUnlessRecent.mockResolvedValueOnce(false); // a code went out moments ago
    await expect(
      service.register({ email: 'a@example.com', password: 'Thread2027', fullName: 'Ada Obi' }),
    ).resolves.toEqual({ email: 'a@example.com' });
    expect(users.rows).toHaveLength(1);
    expect(await bcrypt.compare('Thread2027', users.rows[0].passwordHash!)).toBe(true);
  });

  it('blocks login until the email is verified', async () => {
    await service.register({ email: 'a@example.com', password: 'Needle2026', fullName: 'Ada Obi' });
    await expect(service.login({ email: 'a@example.com', password: 'Needle2026' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    await verifiedUser();
    await expect(service.login({ email: 'a@example.com', password: 'nope12345' })).rejects.toThrow(
      'Incorrect email or password.',
    );
    await expect(service.login({ email: 'b@example.com', password: 'Needle2026' })).rejects.toThrow(
      'Incorrect email or password.',
    );
  });

  it('rotates refresh tokens and treats reuse of an old one as a replay', async () => {
    const first = await verifiedUser();
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // The replay also revoked the newest token.
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout invalidates the refresh token', async () => {
    const session = await verifiedUser();
    await service.logout(session.user.id);
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resetting the password signs out existing sessions', async () => {
    const session = await verifiedUser();
    await service.resetPassword({ email: 'a@example.com', code: '654321', password: 'Fresh2027x' });
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login({ email: 'a@example.com', password: 'Fresh2027x' })).resolves.toHaveProperty('accessToken');
  });

  describe('suspended accounts', () => {
    const suspend = () => {
      users.rows[0].status = 'suspended';
    };

    it('refuses sign-in with a clear message', async () => {
      await verifiedUser();
      suspend();
      const err = await service.login({ email: 'a@example.com', password: 'Needle2026' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    });

    it('refuses to refresh and revokes the refresh token', async () => {
      const session = await verifiedUser();
      suspend();
      const err = await service.refresh(session.refreshToken).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      expect(users.update).toHaveBeenLastCalledWith(session.user.id, { refreshTokenHash: null });
    });

    it('does not start a session from a sign-up code', async () => {
      await service.register({ email: 'b@example.com', password: 'Needle2026', fullName: 'Bola' });
      suspend();
      await expect(service.verifyEmail({ email: 'b@example.com', code: '123456' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('never lets sign-up take over an admin account', async () => {
    users.rows.push({ id: 'admin-1', email: 'boss@example.com', role: UserRole.ADMIN, status: 'active', emailVerified: false } as User);
    await expect(
      service.register({ email: 'boss@example.com', password: 'Needle2026', fullName: 'Mallory' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
