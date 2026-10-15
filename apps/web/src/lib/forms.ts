import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { toast } from '@/components/ui/sonner';
import { isApiError } from './api/client';

/**
 * Shows an API error on the form: field errors inline (the API's field paths, such as
 * "owner.email", match the form's), anything else as a toast unless `toast: false`.
 * Returns true when at least one field error was placed.
 */
export function showFormError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
  options: { toast?: boolean } = {},
) {
  let placed = false;
  if (isApiError(error) && error.errors) {
    for (const [path, message] of Object.entries(error.errors)) {
      if (!fields.includes(path)) continue;
      setError(path as Path<T>, { type: 'server', message }, { shouldFocus: !placed });
      placed = true;
    }
  }
  if (!placed && options.toast !== false) {
    toast.error(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
  }
  return placed;
}
