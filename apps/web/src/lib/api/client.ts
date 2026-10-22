import { CSRF_COOKIE, CSRF_HEADER } from '../auth/constants';
import { createSeed, type MockDb } from '../mock/seed';

/**
 * Prototype backend adapter.
 *
 * Modules not yet built on the NestJS API (patients, appointments, …) go through
 * `backend()`, an in-memory store seeded on first use in the browser. Modules backed by
 * the API (auth, center, staff) use `request()` below. When a module moves to the API,
 * replace its service bodies with `request()` calls and keep the function signatures,
 * so screens and hooks don't change.
 */

let db: MockDb | null = null;

export function backend(): MockDb {
  if (typeof window === 'undefined') {
    throw new Error('The prototype data store is browser-only. Fetch data from client components.');
  }
  db ??= createSeed();
  return db;
}

/** Simulated network latency so loading states are exercised during development. */
export function latency(ms = 250 + Math.random() * 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    /** Machine-readable reason from the API, e.g. LAST_ADMIN */
    public readonly code?: string,
    /** Field path → message, e.g. { 'owner.email': 'Already registered' } */
    public readonly errors?: Record<string, string>,
    /** Structured data some codes carry, e.g. the conflicts behind a 409 */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Same-origin path that next.config.ts rewrites to the NestJS API. */
const API_BASE = '/api';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCookie(name: string) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

let csrfRequest: Promise<void> | null = null;

/** The API issues the CSRF cookie on demand; fetch it once before the first write. */
async function csrfToken() {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    csrfRequest ??= fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin' }).then(() => {
      csrfRequest = null;
    });
    await csrfRequest;
    token = readCookie(CSRF_COOKIE);
  }
  return token ?? '';
}

/**
 * Calls the Carezino API. The session lives in an HttpOnly cookie the browser sends on
 * its own; state-changing requests also echo the CSRF cookie in a header. Errors are
 * thrown as ApiError with the API's user-facing message.
 */
export async function request<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (!SAFE_METHODS.has(method)) headers.set(CSRF_HEADER, await csrfToken());

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Can’t reach Carezino. Check your connection and try again.', 0);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
      code?: string;
      errors?: Record<string, string>;
    } & Record<string, unknown>;
    const { message: raw, code, errors, ...details } = body;
    const message = Array.isArray(raw) ? raw[0] : raw;
    throw new ApiError(
      message ??
        (res.status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : res.statusText),
      res.status,
      code,
      errors,
      details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/** Deep-ish copy so callers can't mutate the store through returned objects. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
