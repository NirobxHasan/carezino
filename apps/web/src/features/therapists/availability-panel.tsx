'use client';

import * as React from 'react';
import { Globe } from 'lucide-react';

import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { isApiError } from '@/lib/api/client';
import { useGeneralSettings } from '@/lib/api/settings';
import { useSaveTherapistAvailability, useTherapistAvailability } from '@/lib/api/therapists';
import { formatMinutes } from '@/lib/settings-limits';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type { TherapistWeek } from '@/lib/types';
import {
  AvailabilityEditor,
  toAvailabilityInput,
  validateWeek,
  type DayValue,
} from './availability-editor';

function toDays(week: TherapistWeek): DayValue[] {
  return week.days.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    isAvailable: d.isAvailable,
    intervals: d.intervals.map(({ start, end }) => ({ start, end })),
  }));
}

function WeekForm({
  therapistId,
  week,
  weekStartsOn,
}: {
  therapistId: string;
  week: TherapistWeek;
  weekStartsOn: number;
}) {
  const { can } = useSession();
  const editable = can('therapists.manage_availability');
  const save = useSaveTherapistAvailability();
  const [initial, setInitial] = React.useState(() => toDays(week));
  const [days, setDays] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const dirty =
    JSON.stringify(toAvailabilityInput(days)) !== JSON.stringify(toAvailabilityInput(initial));
  useUnsavedChanges(dirty);

  const onSave = async () => {
    const found = validateWeek(days);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Please fix the highlighted hours');
      return;
    }
    try {
      const saved = await save.mutateAsync({ id: therapistId, days: toAvailabilityInput(days) });
      const next = toDays(saved);
      setInitial(next);
      setDays(next);
      toast.success('Weekly availability saved');
    } catch (error) {
      if (isApiError(error) && error.errors) setErrors(error.errors);
      toast.error(error instanceof Error ? error.message : 'Couldn’t save availability');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly availability</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 flex items-start gap-2 text-[13px] text-muted-foreground">
          <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            The hours this therapist normally works at this center, in {week.timezone}. Changes
            apply to new bookings only; existing appointments are never moved.
            {week.summary.weeklyMinutes > 0 &&
              ` Currently ${formatMinutes(week.summary.weeklyMinutes)} a week.`}
          </span>
        </p>
        {!editable && (
          <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            You can view these hours. Ask a center administrator or manager to change them.
          </p>
        )}
        <AvailabilityEditor
          value={days}
          onChange={(next) => {
            setDays(next);
            if (Object.keys(errors).length) setErrors(validateWeek(next));
          }}
          errors={errors}
          centerHours={week.centerHours}
          weekStartsOn={weekStartsOn}
          disabled={!editable}
        />
      </CardContent>
      {editable && (
        <CardFooter className="justify-end">
          {dirty && (
            <span className="mr-auto text-[13px] text-muted-foreground" role="status">
              Unsaved changes
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDays(initial);
              setErrors({});
            }}
          >
            Discard changes
          </Button>
          <Button type="button" loading={save.isPending} disabled={!dirty} onClick={onSave}>
            Save availability
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function AvailabilityPanel({ therapistId }: { therapistId: string }) {
  const { data, isPending, error, refetch } = useTherapistAvailability(therapistId);
  const general = useGeneralSettings();
  if (isPending || general.isPending) return <PageSkeleton />;
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }
  return (
    <WeekForm
      key={JSON.stringify(data.days)}
      therapistId={therapistId}
      week={data}
      weekStartsOn={general.data?.weekStartsOn ?? 6}
    />
  );
}
