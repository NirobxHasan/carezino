'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTherapyTypes } from '@/lib/api/config';
import type { DisciplineAccent, ID } from '@/lib/types';
import { cn } from '@/lib/utils';

export const accentDot: Record<DisciplineAccent, string> = {
  ot: 'bg-discipline-ot',
  aba: 'bg-discipline-aba',
  slt: 'bg-discipline-slt',
  other: 'bg-discipline-other',
};

/** Left border + tint for calendar blocks. */
export const accentBlock: Record<DisciplineAccent, string> = {
  ot: 'border-l-discipline-ot bg-teal-50/80',
  aba: 'border-l-discipline-aba bg-violet-50/80',
  slt: 'border-l-discipline-slt bg-pink-50/80',
  other: 'border-l-discipline-other bg-slate-50',
};

/** Small coloured dot + short code (OT, ABA, SLT). Full name is exposed to assistive tech. */
export function TherapyTypeTag({
  id,
  full = false,
  className,
}: {
  id: ID;
  full?: boolean;
  className?: string;
}) {
  const { byId } = useTherapyTypes();
  const type = byId.get(id);
  if (!type) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-foreground',
        className,
      )}
      title={type.name}
    >
      <span className={cn('size-2 shrink-0 rounded-full', accentDot[type.accent])} aria-hidden />
      {full ? (
        type.name
      ) : (
        <>
          <span aria-hidden>{type.code}</span>
          <span className="sr-only">{type.name}</span>
        </>
      )}
    </span>
  );
}

export function TherapyTypeTags({ ids }: { ids: ID[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {ids.map((id) => (
        <TherapyTypeTag key={id} id={id} />
      ))}
    </span>
  );
}

/** Select one therapy type. Only active types are offered. */
export function TherapyTypeSelector({
  value,
  onChange,
  allowAll = false,
  allowedIds,
  placeholder = 'Select therapy type',
  size,
  className,
  ...trigger
}: Omit<React.ComponentProps<typeof SelectTrigger>, 'value' | 'onChange'> & {
  value?: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  /** Restrict to these ids, e.g. a patient's therapy types */
  allowedIds?: ID[];
  placeholder?: string;
}) {
  const { active } = useTherapyTypes();
  const options = allowedIds ? active.filter((t) => allowedIds.includes(t.id)) : active;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size={size} className={className} {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="all">All therapy types</SelectItem>}
        {options.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', accentDot[t.accent])} aria-hidden />
              {t.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
