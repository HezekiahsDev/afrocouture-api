import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or a whole controller) out of the global JwtAuthGuard. Every route is
 * authenticated unless it carries this — see docs/rbac.md.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
