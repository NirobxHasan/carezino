'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { inputBaseClass } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface Option {
  value: string;
  label: string;
  description?: string;
  /** Rendered before the label, e.g. an avatar */
  leading?: React.ReactNode;
  disabled?: boolean;
  /** Extra text that search should match */
  keywords?: string[];
}

type TriggerProps = Omit<React.ComponentProps<'button'>, 'value' | 'onChange'>;

/**
 * Combobox for one value. For server-side search pass `onSearch` and keep `options`
 * updated with the results; filtering is then left to the caller.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  onSearch,
  loading,
  renderValue,
  disabled,
  className,
  ...trigger
}: TriggerProps & {
  options: Option[];
  value?: string;
  onChange: (value: string | undefined, option?: Option) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onSearch?: (query: string) => void;
  loading?: boolean;
  /** Custom display for the selected value; useful when it isn't in the current options */
  renderValue?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            inputBaseClass,
            'flex h-10 items-center justify-between gap-2 px-3 text-left',
            !value && 'text-subtle-foreground',
            className,
          )}
          {...trigger}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {value
              ? (renderValue ??
                (selected ? (
                  <>
                    {selected.leading}
                    {selected.label}
                  </>
                ) : (
                  value
                )))
              : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent id={listId} className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command shouldFilter={!onSearch}>
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearch} />
          <CommandList>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
            ) : (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  keywords={o.keywords}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value, o);
                    setOpen(false);
                  }}
                >
                  {o.leading}
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{o.label}</span>
                    {o.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      'size-4 text-primary',
                      o.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Pick several values; selected items show as removable chips. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  compact = false,
  label,
  disabled,
  className,
  ...trigger
}: TriggerProps & {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Show a count instead of chips, for filter bars */
  compact?: boolean;
  /** Prefix shown in compact mode, e.g. "Therapist" */
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            inputBaseClass,
            'flex items-center justify-between gap-2 text-left',
            compact ? 'h-9 w-auto px-3 text-[13px]' : 'min-h-10 px-2 py-1.5',
            !selected.length && 'text-subtle-foreground',
            className,
          )}
          {...trigger}
        >
          {compact ? (
            <span className="truncate">
              {label && <span className="text-muted-foreground">{label}: </span>}
              <span className="text-foreground">
                {selected.length === 0
                  ? 'All'
                  : selected.length === 1
                    ? selected[0].label
                    : `${selected.length} selected`}
              </span>
            </span>
          ) : selected.length ? (
            <span className="flex flex-wrap gap-1">
              {selected.map((o) => (
                <Badge key={o.value} tone="outline" className="gap-1 pr-1">
                  {o.label}
                  {/* Pointer shortcut only; keyboard and screen-reader users toggle from the list. */}
                  <span
                    aria-hidden
                    className="rounded-sm p-0.5 hover:bg-accent"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))}
            </span>
          ) : (
            <span className="px-1">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent id={listId} className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          {options.length > 6 && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    disabled={o.disabled}
                    onSelect={() => toggle(o.value)}
                    aria-selected={checked}
                  >
                    <span
                      className={cn(
                        'grid size-4 place-items-center rounded-[4px] border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border-strong',
                      )}
                      aria-hidden
                    >
                      {checked && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    {o.leading}
                    <span className="flex-1 truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-center text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onChange([])}
              >
                Clear selection
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
