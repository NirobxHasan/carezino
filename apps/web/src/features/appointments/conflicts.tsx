'use client';

import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import type { AppointmentConflict } from '@/lib/types';

const CONFLICT_CODES = ['APPOINTMENT_CONFLICT', 'SLOT_TAKEN'];

/** The conflicts behind a booking 409, or null for any other error. */
export function conflictOf(error: unknown) {
  if (!isApiError(error, 409) || !CONFLICT_CODES.includes(error.code ?? '')) return null;
  return {
    message: error.message,
    conflicts: (error.details.conflicts as AppointmentConflict[] | undefined) ?? [],
    /** Clashes only, and the center allows double booking */
    overridable: error.details.overridable === true,
    /** Another booking won the race for this time */
    taken: error.code === 'SLOT_TAKEN',
  };
}

/**
 * Why a time couldn't be booked. Where the center allows double booking and the only
 * problem is a clash, staff can book anyway, deliberately.
 */
export function ConflictNotice({
  error,
  onOverride,
  overriding,
}: {
  error: unknown;
  onOverride?: () => void;
  overriding?: boolean;
}) {
  const conflict = conflictOf(error);
  if (!conflict) return null;
  const messages = conflict.conflicts.map((c) => c.message).filter(Boolean);
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2.5 text-[13px] text-warning-foreground"
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
        {conflict.taken
          ? conflict.message
          : messages.length > 1
            ? 'This time can’t be booked:'
            : (messages[0] ?? conflict.message)}
      </p>
      {!conflict.taken && messages.length > 1 && (
        <ul className="ml-6 list-disc space-y-0.5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {conflict.overridable && onOverride && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span>Your center allows double booking.</span>
          <Button size="sm" variant="secondary" loading={overriding} onClick={onOverride}>
            Book anyway
          </Button>
        </div>
      )}
    </div>
  );
}
