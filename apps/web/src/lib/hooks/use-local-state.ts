'use client';

import { useCallback, useSyncExternalStore } from 'react';

const memory = new Map<string, string>();

/**
 * A small per-browser preference (sidebar collapsed, calendar view). Falls back to an
 * in-memory value when storage is unavailable, and keeps tabs in sync.
 */
export function useLocalState<T extends string | boolean>(key: string, fallback: T) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (e: StorageEvent | Event) => {
        if (!(e instanceof StorageEvent) || e.key === key) onChange();
      };
      window.addEventListener('storage', handler);
      window.addEventListener(`local-state:${key}`, handler);
      return () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener(`local-state:${key}`, handler);
      };
    },
    [key],
  );

  const read = useCallback((): T => {
    let raw: string | null = memory.get(key) ?? null;
    try {
      raw = window.localStorage.getItem(key) ?? raw;
    } catch {
      // storage blocked: use the in-memory value
    }
    if (raw === null) return fallback;
    return (typeof fallback === 'boolean' ? raw === 'true' : raw) as T;
  }, [key, fallback]);

  const value = useSyncExternalStore(subscribe, read, () => fallback);

  const set = useCallback(
    (next: T) => {
      memory.set(key, String(next));
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // ignore: preference just won't persist
      }
      window.dispatchEvent(new Event(`local-state:${key}`));
    },
    [key],
  );

  return [value, set] as const;
}
