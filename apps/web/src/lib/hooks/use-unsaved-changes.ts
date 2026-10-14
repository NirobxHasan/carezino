'use client';

import { useEffect } from 'react';

/**
 * Warns before the tab is closed or reloaded while a form has unsaved changes.
 * In-app navigation is handled by the form's Cancel button, which asks first.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
