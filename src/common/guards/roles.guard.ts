import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { UserRole } from '../../types/index.js';
import type { User } from '../../users/entities/user.entity.js';

/**
 * Registered globally after JwtAuthGuard. Routes with @Roles(...) are limited to those roles;
 * the role comes from the user row JwtStrategy loaded, never from the token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<{ user?: User }>();
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException("Your account doesn't have access to this.");
    }
    return true;
  }
}
