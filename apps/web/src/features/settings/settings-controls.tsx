'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** A yes/no setting with a short explanation, laid out across the form's full width. */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 sm:col-span-2">
      <label htmlFor={id} className="grid cursor-pointer gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </span>
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
      />
    </div>
  );
}

export type TimeUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export const UNIT_MINUTES: Record<TimeUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/** The largest unit that represents `minutes` exactly: 720 → 12 hours. */
export function splitDuration(minutes: number, units: readonly TimeUnit[]) {
  const unit =
    [...units]
      .sort((a, b) => UNIT_MINUTES[b] - UNIT_MINUTES[a])
      .find((u) => minutes % UNIT_MINUTES[u] === 0 && minutes >= UNIT_MINUTES[u]) ?? units[0];
  return { value: minutes / UNIT_MINUTES[unit], unit };
}

/**
 * A number and its unit side by side. Receives the id and aria attributes from Field
 * (via Slot) and puts them on the number input, which the label points at.
 */
export function NumberWithUnit({
  value,
  onChange,
  unit,
  onUnitChange,
  units,
  disabled,
  min = 0,
  ...aria
}: {
  value: number;
  onChange: (value: number) => void;
  unit: TimeUnit;
  onUnitChange: (unit: TimeUnit) => void;
  units: readonly TimeUnit[];
  disabled?: boolean;
  min?: number;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        disabled={disabled}
        className="w-28 tabular"
        {...aria}
      />
      <Select value={unit} onValueChange={(u) => onUnitChange(u as TimeUnit)} disabled={disabled}>
        <SelectTrigger className="w-32" aria-label="Unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {units.map((u) => (
            <SelectItem key={u} value={u}>
              {u[0].toUpperCase() + u.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Save / discard bar for settings forms, with a visible unsaved-changes marker. */
export function SettingsFormFooter({
  dirty,
  submitting,
  onDiscard,
  className,
}: {
  dirty: boolean;
  submitting: boolean;
  onDiscard: () => void;
  className?: string;
}) {
  return (
    <CardFooter className={cn('justify-end', className)}>
      {dirty && (
        <span className="mr-auto text-[13px] text-muted-foreground" role="status">
          Unsaved changes
        </span>
      )}
      <Button type="button" variant="secondary" disabled={!dirty || submitting} onClick={onDiscard}>
        Discard changes
      </Button>
      <Button type="submit" loading={submitting} disabled={!dirty}>
        Save changes
      </Button>
    </CardFooter>
  );
}
