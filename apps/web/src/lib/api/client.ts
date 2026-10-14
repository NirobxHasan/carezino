import { createSeed, type MockDb } from '../mock/seed';

/**
 * Prototype backend adapter.
 *
 * Every service function in lib/api goes through `backend()`. Today it returns an
 * in-memory store seeded on first use in the browser; when the NestJS API is ready,
 * replace the service bodies with `request()` calls and keep the function signatures,
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
  ) {
    super(message);
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Real HTTP client for when endpoints exist. Not used by the prototype yet. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

/** Deep-ish copy so callers can't mutate the store through returned objects. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
