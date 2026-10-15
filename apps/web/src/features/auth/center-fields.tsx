'use client';

import * as React from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';

import { SearchableSelect } from '@/components/forms/searchable-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BD_DISTRICTS, CURRENCIES, timezoneOptions } from '@/lib/locale-options';

/** Free text with the Bangladesh districts as suggestions (the input carries `list`). */
export function DistrictSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {BD_DISTRICTS.map((d) => (
        <option key={d} value={d} />
      ))}
    </datalist>
  );
}

export function TimezoneSelect<T extends FieldValues>({
  control,
  name,
  disabled,
}: {
  control: Control<T>;
  name: Path<T>;
  disabled?: boolean;
}) {
  const options = React.useMemo(() => timezoneOptions(), []);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SearchableSelect
          options={options}
          value={field.value as string}
          onChange={(v) => field.onChange(v ?? '')}
          placeholder="Select a time zone"
          searchPlaceholder="Search time zones…"
          disabled={disabled}
        />
      )}
    />
  );
}

export function CurrencySelect<T extends FieldValues>({
  control,
  name,
  disabled,
}: {
  control: Control<T>;
  name: Path<T>;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select value={field.value as string} onValueChange={field.onChange} disabled={disabled}>
          <SelectTrigger onBlur={field.onBlur}>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}
