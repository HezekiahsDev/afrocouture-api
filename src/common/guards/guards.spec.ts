import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { Public } from '../decorators/public.decorator.js';
import { Roles } from '../decorators/roles.decorator.js';
import { UserRole } from '../../types/index.js';

class Routes {
  @Public()
  open() {}

  closed() {}

  @Roles(UserRole.ADMIN)
  adminOnly() {}
}

@Public()
class PublicController {
  anything() {}
}

function context(handler: keyof Routes | 'anything', opts: { user?: { role: UserRole }; type?: string } = {}) {
  const target = handler === 'anything' ? PublicController : Routes;
  return {
    getType: () => opts.type ?? 'http',
    getHandler: () => (target.prototype as any)[handler],
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user: opts.user, headers: {} }), getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard (global)', () => {
  const guard = new JwtAuthGuard(new Reflector());

  it('lets @Public() routes and controllers through without a token', () => {
    expect(guard.canActivate(context('open'))).toBe(true);
    expect(guard.canActivate(context('anything'))).toBe(true);
  });

  it('leaves WebSocket handlers to the gateway handshake', () => {
    expect(guard.canActivate(context('closed', { type: 'ws' }))).toBe(true);
  });

  it('requires a token everywhere else', async () => {
    const result = (async () => guard.canActivate(context('closed')))();
    await expect(result).rejects.toThrow();
  });
});

describe('RolesGuard (global)', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(context('closed', { user: { role: UserRole.CUSTOMER } }))).toBe(true);
  });

  it('allows the listed role and refuses the others with 403', () => {
    expect(guard.canActivate(context('adminOnly', { user: { role: UserRole.ADMIN } }))).toBe(true);
    expect(() => guard.canActivate(context('adminOnly', { user: { role: UserRole.TAILOR } }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context('adminOnly'))).toThrow(ForbiddenException);
  });
});
