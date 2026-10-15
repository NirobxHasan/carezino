'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';

import { can as canFor, type Permission } from './permissions';
import type { ActiveCenter, Me, Role, User } from './types';

/**
 * The signed-in user and the center they're working in. Provided by AuthGate, which
 * only renders its children once /auth/me has confirmed a session with an active center.
 */
export const SessionContext = createContext<(Me & { activeCenter: ActiveCenter }) | null>(null);

export function useSession() {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession must be used inside AuthGate');
  const { activeCenter } = me;
  const user = useMemo<User>(
    () => ({
      id: me.user.id,
      name: me.user.fullName,
      email: me.user.email,
      role: activeCenter.role,
    }),
    [me.user, activeCenter.role],
  );
  const check = useCallback(
    (permission: Permission) => canFor(activeCenter, permission),
    [activeCenter],
  );
  return {
    me,
    user,
    role: activeCenter.role as Role,
    activeCenter,
    centers: me.centers,
    can: check,
  };
}
