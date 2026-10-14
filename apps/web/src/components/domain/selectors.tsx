'use client';

import * as React from 'react';

import { SearchableSelect, type Option } from '@/components/forms/searchable-select';
import { Avatar } from '@/components/ui/avatar';
import { usePatient, usePatientSearch } from '@/lib/api/patients';
import { useTherapists } from '@/lib/api/therapists';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { formatPhone } from '@/lib/format';
import type { ID } from '@/lib/types';

type TriggerProps = Omit<React.ComponentProps<'button'>, 'value' | 'onChange'>;

/** Find a patient by name, Bangla name, patient ID or guardian phone. */
export function PatientSelector({
  value,
  onChange,
  placeholder = 'Search patient by name, ID or phone',
  ...trigger
}: TriggerProps & {
  value?: ID;
  onChange: (id: ID | undefined) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = React.useState('');
  const debounced = useDebounced(query, 200);
  const { data = [], isFetching } = usePatientSearch(debounced);
  const { data: selected } = usePatient(value);

  const options: Option[] = data.map((p) => ({
    value: p.id,
    label: p.fullName,
    description: `${p.code} · ${p.guardian.name} · ${formatPhone(p.guardian.phone)}`,
    leading: <Avatar name={p.fullName} size="sm" />,
  }));

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={(v) => onChange(v)}
      onSearch={setQuery}
      loading={isFetching && !data.length}
      placeholder={placeholder}
      searchPlaceholder="Name, CZ-ID or guardian phone"
      emptyText="No matching patients. Check the spelling or register a new patient."
      renderValue={
        selected ? (
          <>
            <Avatar name={selected.fullName} size="sm" className="size-6 text-[10px]" />
            <span className="truncate text-foreground">{selected.fullName}</span>
            <span className="text-xs text-muted-foreground">{selected.code}</span>
          </>
        ) : undefined
      }
      {...trigger}
    />
  );
}

/** Pick a therapist, optionally limited to those who provide a therapy type. */
export function TherapistSelector({
  value,
  onChange,
  therapyTypeId,
  includeUnavailable = false,
  placeholder = 'Select therapist',
  ...trigger
}: TriggerProps & {
  value?: ID;
  onChange: (id: ID | undefined) => void;
  therapyTypeId?: ID;
  includeUnavailable?: boolean;
  placeholder?: string;
}) {
  const { data = [], isLoading } = useTherapists();
  const options: Option[] = data
    .filter((t) => !therapyTypeId || t.specializationIds.includes(therapyTypeId))
    .filter((t) => includeUnavailable || t.status !== 'inactive')
    .map((t) => ({
      value: t.id,
      label: t.name,
      description:
        t.status === 'on_leave'
          ? 'On leave'
          : `${t.title} · ${t.todayBooked}/${t.todayCapacity} booked today`,
      disabled: t.status === 'on_leave' && !includeUnavailable,
      leading: <Avatar name={t.name} size="sm" />,
    }));

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={(v) => onChange(v)}
      loading={isLoading}
      placeholder={placeholder}
      searchPlaceholder="Search therapists"
      emptyText={therapyTypeId ? 'No therapist offers this therapy yet.' : 'No therapists.'}
      {...trigger}
    />
  );
}
