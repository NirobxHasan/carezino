import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../generated/prisma/enums';
import type { AuthContext } from './auth-context';
import { CsrfGuard, PermissionsGuard } from './guards';
import { hasPermission, permissionsFor, type Permission } from './permissions';

function context(req: object, required?: Permission[]) {
  const handler = () => undefined;
  if (required) Reflect.defineMetadata('auth:permissions', required, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function authAs(role: Role | null): AuthContext {
  return {
    sessionId: 's',
    user: {
      id: 'u',
      email: 'u@example.com',
      fullName: 'U',
      isPlatformAdmin: false,
    },
    membership: role
      ? { id: 'm', centerId: 'c', role, permissions: permissionsFor(role) }
      : null,
  };
}

describe('role permissions', () => {
  it('gives only center admins access-control permissions', () => {
    for (const p of [
      'center.update',
      'staff.create',
      'staff.assign_role',
      'staff.deactivate',
    ] as const) {
      expect(hasPermission(Role.CENTER_ADMIN, p)).toBe(true);
      expect(hasPermission(Role.MANAGER, p)).toBe(false);
      expect(hasPermission(Role.RECEPTIONIST, p)).toBe(false);
      expect(hasPermission(Role.THERAPIST, p)).toBe(false);
    }
  });

  it('lets managers read staff but not therapists or receptionists', () => {
    expect(hasPermission(Role.MANAGER, 'staff.read')).toBe(true);
    expect(hasPermission(Role.THERAPIST, 'staff.read')).toBe(false);
    expect(hasPermission(Role.RECEPTIONIST, 'staff.read')).toBe(false);
  });

  it('returns a copy, so callers cannot widen a role', () => {
    permissionsFor(Role.THERAPIST).push('staff.create');
    expect(hasPermission(Role.THERAPIST, 'staff.create')).toBe(false);
  });
});

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows routes without required permissions', () => {
    expect(guard.canActivate(context({ auth: authAs(Role.THERAPIST) }))).toBe(
      true,
    );
  });

  it('denies when any required permission is missing', () => {
    const ctx = context({ auth: authAs(Role.MANAGER) }, [
      'staff.read',
      'staff.create',
    ]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows when every required permission is granted', () => {
    const ctx = context({ auth: authAs(Role.CENTER_ADMIN) }, [
      'staff.read',
      'staff.create',
    ]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies signed-in users without an active center', () => {
    expect(() =>
      guard.canActivate(context({ auth: authAs(null) }, ['center.read'])),
    ).toThrow(ForbiddenException);
  });

  it('denies anonymous callers', () => {
    expect(() => guard.canActivate(context({}, ['center.read']))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  const req = (method: string, cookie?: string, header?: string) => ({
    method,
    cookies: cookie ? { cz_csrf: cookie } : {},
    get: (name: string) => (name === 'x-csrf-token' ? header : undefined),
  });

  it('lets safe methods through', () => {
    expect(guard.canActivate(context(req('GET')))).toBe(true);
  });

  it('requires the header to match the cookie on state-changing requests', () => {
    expect(guard.canActivate(context(req('POST', 'abc', 'abc')))).toBe(true);
    expect(() => guard.canActivate(context(req('POST', 'abc', 'abd')))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context(req('PATCH', 'abc')))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(context(req('DELETE', undefined, 'abc'))),
    ).toThrow(ForbiddenException);
  });
});
