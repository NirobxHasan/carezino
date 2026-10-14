'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { can, type Permission } from './permissions';
import type { Role, User } from './types';

/**
 * Prototype session. Until authentication is wired to the API, the signed-in user is
 * one of these demo accounts and can be switched from the user menu to preview
 * role-based navigation.
 */
export const DEMO_USERS: Record<Role, User> = {
  manager: {
    id: 'usr_manager',
    name: 'Nadia Chowdhury',
    email: 'nadia@shishubikash.example',
    role: 'manager',
  },
  admin: {
    id: 'usr_admin',
    name: 'Kamrul Islam',
    email: 'kamrul@shishubikash.example',
    role: 'admin',
  },
  receptionist: {
    id: 'usr_reception',
    name: 'Rafiq Uddin',
    email: 'rafiq@shishubikash.example',
    role: 'receptionist',
  },
  therapist: {
    id: 'usr_therapist',
    name: 'Farhana Rahman',
    email: 'farhana@shishubikash.example',
    role: 'therapist',
    therapistId: 'th_1',
  },
};

const STORAGE_KEY = 'carezino.demo-role';
const DEFAULT_ROLE: Role = 'manager';
const listeners = new Set<() => void>();
let current: Role | null = null;

function read(): Role {
  if (current) return current;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Role | null;
    current = stored && stored in DEMO_USERS ? stored : DEFAULT_ROLE;
  } catch {
    current = DEFAULT_ROLE;
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDemoRole(role: Role) {
  current = role;
  try {
    window.localStorage.setItem(STORAGE_KEY, role);
  } catch {
    // Storage can be unavailable (private mode); the switch still applies for this tab.
  }
  listeners.forEach((l) => l());
}

export function useSession() {
  const role = useSyncExternalStore(subscribe, read, () => DEFAULT_ROLE);
  const user = DEMO_USERS[role];
  const check = useCallback((permission: Permission) => can(role, permission), [role]);
  return { user, role, can: check };
}
