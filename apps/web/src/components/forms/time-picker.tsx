'use client';

import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatClock } from '@/lib/format';

function buildTimes(min: string, max: string, step: number) {
  const [minH, minM] = min.split(':').map(Number);
  const [maxH, maxM] = max.split(':').map(Number);
  const out: string[] = [];
  for (let t = minH * 60 + minM; t <= maxH * 60 + maxM; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
}

/** Time of day as "HH:mm", picked from fixed increments (no free typing). */
export function TimePicker({
  value,
  onChange,
  min = '07:00',
  max = '21:00',
  step = 30,
  placeholder = 'Select time',
  ...trigger
}: Omit<React.ComponentProps<typeof SelectTrigger>, 'value' | 'onChange'> & {
  value?: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  step?: number;
  placeholder?: string;
}) {
  const times = React.useMemo(() => {
    const options = buildTimes(min, max, step);
    // A saved time off the step (e.g. 09:10) still shows rather than appearing blank.
    return value && !options.includes(value) ? [...options, value].sort() : options;
  }, [min, max, step, value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {times.map((t) => (
          <SelectItem key={t} value={t}>
            {formatClock(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
