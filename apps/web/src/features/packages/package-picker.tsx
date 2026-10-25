'use client';

import * as React from 'react';
import Link from 'next/link';

import { Field } from '@/components/forms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnrollmentOptions, type EnrollmentOptionsParams } from '@/lib/api/packages';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { packageLinks } from './package-display';

const NONE = 'none';

/**
 * Which of the patient's packages pays for a session, judged by the same rules as
 * booking (therapy, type, date, balance, usage limit). Packages that can't are listed
 * disabled with the reason. With exactly one that can, it's preselected; "No package"
 * is always there. Hidden for staff who can't read packages.
 */
export function PackagePicker({
  params,
  value,
  onChange,
  error,
  className,
}: {
  /** Null until patient, therapy and date are known */
  params: EnrollmentOptionsParams | null;
  /** The chosen enrollment; null is "no package" */
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string;
  className?: string;
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const allowed = can('package_enrollments.read');
  const options = useEnrollmentOptions(allowed ? params : null);
  const items = React.useMemo(
    () => (params ? (options.data?.items ?? []) : []),
    [params, options.data],
  );
  const eligible = items.filter((o) => o.eligible);

  // Staff who haven't chosen get the one package that fits; a choice that stops
  // fitting (another therapy or date) is cleared.
  const [touched, setTouched] = React.useState(false);
  const loaded = Boolean(params && options.data && !options.isPlaceholderData);
  React.useEffect(() => {
    if (!loaded) return;
    if (value && !eligible.some((o) => o.id === value)) onChange(null);
    else if (!value && !touched && eligible.length === 1) onChange(eligible[0].id);
    // eligible is derived from options.data, which `loaded` follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, options.data, value, touched]);

  if (!allowed) return null;
  const helper = !params
    ? 'Choose the patient, therapy and date first'
    : options.data && !items.length
      ? 'This patient has no package with sessions left.'
      : eligible.length
        ? 'One session is held when booked and used when the session is completed.'
        : options.data
          ? 'None of the patient’s packages covers this session.'
          : undefined;

  return (
    <Field
      label="Package"
      optional
      error={error}
      className={className}
      helper={helper}
      labelAction={
        params && can('package_enrollments.create') ? (
          <Link
            href={packageLinks.enroll({ patientId: params.patientId })}
            className="text-xs text-primary hover:underline"
          >
            Enroll in a package
          </Link>
        ) : undefined
      }
    >
      <Select
        value={value ?? NONE}
        onValueChange={(v) => {
          setTouched(true);
          onChange(v === NONE ? null : v);
        }}
        disabled={!params}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No package (pay per session)</SelectItem>
          {items.map((o) => (
            <SelectItem key={o.id} value={o.id} disabled={!o.eligible}>
              <span className="flex flex-col">
                <span>
                  {o.package.name} · {o.sessions.availableToBook} of {o.sessions.total} free
                  {o.endDate && ` · until ${fmt.date(o.endDate)}`}
                </span>
                {!o.eligible && o.problems[0] && (
                  <span className="text-xs text-muted-foreground">{o.problems[0].message}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
