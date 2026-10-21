'use client';

import * as React from 'react';
import { Check, Pipette } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Distinct, readable colours for calendar blocks and tags. */
export const COLOR_SWATCHES = [
  { value: '#0d9488', name: 'Teal' },
  { value: '#7c3aed', name: 'Violet' },
  { value: '#db2777', name: 'Pink' },
  { value: '#2563eb', name: 'Blue' },
  { value: '#d97706', name: 'Amber' },
  { value: '#16a34a', name: 'Green' },
  { value: '#dc2626', name: 'Red' },
  { value: '#0891b2', name: 'Cyan' },
  { value: '#4f46e5', name: 'Indigo' },
  { value: '#64748b', name: 'Slate' },
];

/**
 * Swatches plus a custom colour. Value is a lower-case hex colour, or '' for none.
 * Rendered as a radio group so it works from the keyboard.
 */
export function ColorPicker({
  value,
  onChange,
  disabled,
  id,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
}) {
  const custom = value !== '' && !COLOR_SWATCHES.some((s) => s.value === value);
  const options = [{ value: '', name: 'No colour' }, ...COLOR_SWATCHES];

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Colour"
      aria-describedby={describedBy}
      className="flex flex-wrap items-center gap-2"
    >
      {options.map((swatch) => {
        const selected = value === swatch.value;
        return (
          <button
            key={swatch.value || 'none'}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatch.name}
            title={swatch.name}
            disabled={disabled}
            onClick={() => onChange(swatch.value)}
            className={cn(
              'grid size-7 place-items-center rounded-full border transition-shadow focus-ring disabled:cursor-not-allowed disabled:opacity-50',
              swatch.value ? 'border-transparent text-white' : 'border-border-strong bg-surface',
              selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-surface',
            )}
            style={swatch.value ? { backgroundColor: swatch.value } : undefined}
          >
            {swatch.value ? (
              selected && <Check className="size-3.5" strokeWidth={3} aria-hidden />
            ) : (
              <span className="h-px w-4 rotate-45 bg-muted-foreground" aria-hidden />
            )}
          </button>
        );
      })}
      <label
        title="Custom colour"
        className={cn(
          'relative grid size-7 cursor-pointer place-items-center rounded-full border border-border-strong bg-surface text-muted-foreground transition-shadow has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30',
          custom &&
            'border-transparent text-white ring-2 ring-foreground ring-offset-2 ring-offset-surface',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        style={custom ? { backgroundColor: value } : undefined}
      >
        <Pipette className="size-3.5" aria-hidden />
        <input
          type="color"
          aria-label="Custom colour"
          disabled={disabled}
          value={value || '#0d9488'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </label>
    </div>
  );
}

/** A small dot in the therapy type's colour, or a neutral one without. */
export function ColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2.5 shrink-0 rounded-full', !color && 'bg-discipline-other', className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
