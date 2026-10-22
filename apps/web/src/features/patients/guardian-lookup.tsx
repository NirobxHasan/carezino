'use client';

import { Info, UserCheck } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useGuardianSearch } from '@/lib/api/patients';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { GuardianMatch, GuardianProfile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { relationshipLabel } from './patient-display';

/** Enough digits that a match means something */
const MIN_DIGITS = 6;

function linkedSummary(match: GuardianMatch) {
  if (!match.patients.length) return 'Not linked to any current patient';
  const shown = match.patients
    .slice(0, 3)
    .map((p) => `${relationshipLabel(p)} of ${p.fullName} (${p.code})`);
  const more = match.linkedPatientCount - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/**
 * Guardians of this center with the number being typed. A matching number doesn't make
 * them the same person (families share phones), so staff choose; nothing is merged.
 */
export function GuardianMatches({
  mobile,
  onSelect,
  excludeIds = [],
  className,
}: {
  mobile: string;
  onSelect: (guardian: GuardianMatch) => void;
  /** Already linked to this patient */
  excludeIds?: string[];
  className?: string;
}) {
  const { can } = useSession();
  const debounced = useDebounced(mobile, 300);
  const digits = debounced.replace(/\D/g, '');
  const enabled = can('guardians.read') && digits.length >= MIN_DIGITS;
  const { data } = useGuardianSearch(debounced, enabled);
  const matches = enabled ? (data ?? []).filter((g) => !excludeIds.includes(g.id)) : [];
  if (!matches.length) return null;

  return (
    <div
      role="region"
      aria-label="Contacts already on record with this number"
      className={cn('grid gap-3 rounded-lg border border-info/25 bg-info-subtle p-3', className)}
    >
      <div className="flex gap-2 text-[13px] text-info-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-medium">Already on record with this number.</span> A matching number
          isn’t proof it’s the same person: check the name before choosing, or carry on to add
          someone new.
        </p>
      </div>
      <ul className="grid gap-2">
        {matches.map((g) => (
          <li
            key={g.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-2.5"
          >
            <Avatar name={g.fullName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{g.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="tabular">{formatPhone(g.mobile)}</span> · {linkedSummary(g)}
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => onSelect(g)}>
              <UserCheck /> Use this contact
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The existing guardian chosen for a link, with a way back to entering someone new. */
export function SelectedGuardian({
  guardian,
  onClear,
  className,
}: {
  guardian: Pick<GuardianProfile, 'fullName' | 'mobile' | 'email' | 'linkedPatientCount'>;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-subtle p-3',
        className,
      )}
    >
      <Avatar name={guardian.fullName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{guardian.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="tabular">{formatPhone(guardian.mobile)}</span>
          {guardian.email && ` · ${guardian.email}`} · existing contact, linked to{' '}
          {guardian.linkedPatientCount} {guardian.linkedPatientCount === 1 ? 'patient' : 'patients'}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Add someone new instead
      </Button>
    </div>
  );
}
