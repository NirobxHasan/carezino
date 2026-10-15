import type { Request } from 'express';

import type { Role } from '../generated/prisma/enums';
import type { Permission } from './permissions';

/** The caller's validated membership in the center the session is working in. */
export interface ActiveMembership {
  id: string;
  centerId: string;
  role: Role;
  permissions: Permission[];
}

/** Attached to the request by SessionGuard once the session cookie has been validated. */
export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    isPlatformAdmin: boolean;
  };
  /** Null when the user has no active membership, or has several and hasn't picked one. */
  membership: ActiveMembership | null;
}

/**
 * Everything a center-scoped service needs. `centerId` always comes from the validated
 * membership, never from the request body, params or headers.
 */
export interface TenantContext {
  centerId: string;
  userId: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export function requestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  };
}
