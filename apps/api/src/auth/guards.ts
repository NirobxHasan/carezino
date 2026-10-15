import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { safeEqual } from '../common/tokens';
import type { AuthenticatedRequest } from './auth-context';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './cookies';
import { IS_PUBLIC, PLATFORM_ADMIN, REQUIRED_PERMISSIONS } from './decorators';
import type { Permission } from './permissions';
import { SessionsService } from './sessions.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check for every state-changing request, signed in or not (login
 * CSRF is a thing too). A cross-site page can't read the cz_csrf cookie, so it can't
 * echo it in the header. SameSite=Lax on the session cookie is the second layer.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[
      CSRF_COOKIE
    ];
    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) {
      throw new ForbiddenException(
        'Your session token is missing or out of date. Reload the page and try again.',
      );
    }
    return true;
  }
}

/** Authenticates every request from the session cookie unless the route is @Public. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (token) req.auth = (await this.sessions.resolve(token)) ?? undefined;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic && !req.auth) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return true;
  }
}

/**
 * Enforces @PlatformAdminOnly and @RequirePermissions (against the active membership).
 * Missing grants are denied.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const platformOnly = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ADMIN,
      [context.getHandler(), context.getClass()],
    );
    if (platformOnly) {
      const { auth } = context
        .switchToHttp()
        .getRequest<AuthenticatedRequest>();
      if (!auth) throw new UnauthorizedException();
      if (!auth.user.isPlatformAdmin) {
        throw new ForbiddenException('You don’t have permission to do this');
      }
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!auth) throw new UnauthorizedException();
    if (!auth.membership)
      throw new ForbiddenException('Select a center to continue');
    const granted = auth.membership.permissions;
    if (!required.every((p) => granted.includes(p))) {
      throw new ForbiddenException('You don’t have permission to do this');
    }
    return true;
  }
}
