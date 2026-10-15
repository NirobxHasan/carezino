import {
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';

import type {
  AuthContext,
  AuthenticatedRequest,
  TenantContext,
} from './auth-context';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const PLATFORM_ADMIN = 'auth:platform-admin';

/** Opens a route to unauthenticated callers. A valid session is still read if present. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires an active center membership that grants every listed permission. Without
 * this decorator a route only requires a signed-in user.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Restricts a route to platform administrators (super admins). These routes work
 * across centers, so they don't use @Tenant().
 */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN, true);

/** The signed-in user. Use on routes that aren't @Public. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    return auth;
  },
);

/** The signed-in user if there is one, for @Public routes that behave differently when signed in. */
export const OptionalAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext | null =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth ?? null,
);

/** The active center context, resolved from the caller's validated membership. */
export const Tenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    const m = auth.membership;
    if (!m) throw new ForbiddenException('Select a center to continue');
    return {
      centerId: m.centerId,
      userId: auth.user.id,
      membershipId: m.id,
      role: m.role,
      permissions: m.permissions,
    };
  },
);
