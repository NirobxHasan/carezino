'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  CalendarClock,
  CalendarOff,
  CalendarX2,
  Ellipsis,
  History,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';

import { StatusBadge } from '@/components/domain/status-badges';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { TimePicker } from '@/components/forms/time-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { SegmentedList, SegmentedTrigger, Tabs, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useGeneralSettings } from '@/lib/api/settings';
import {
  useAddTimeOff,
  useRemoveTimeOff,
  useTherapistTimeOff,
  useUpdateTimeOff,
} from '@/lib/api/therapists';
import { formatCenterClock, formatCenterDate } from '@/lib/format';
import { showFormError } from '@/lib/forms';
import { useSession } from '@/lib/session';
import type { GeneralSettings, TherapistTimeOff, TimeOffReason, TimeOffResult } from '@/lib/types';
import { isoDate } from '@/lib/validation';
import { TIME_OFF_REASONS } from './therapist-display';

type Display = Pick<GeneralSettings, 'dateFormat' | 'timeFormat'>;
const MAX_DAYS = 366;

const schema = z
  .object({
    startDate: isoDate('Start date'),
    endDate: isoDate('End date'),
    isAllDay: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string(),
    note: z.string().trim().max(500),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const span = differenceInCalendarDays(parseISO(v.endDate), parseISO(v.startDate)) + 1;
    if (span < 1) issue('endDate', 'The end date can’t be before the start date');
    else if (span > MAX_DAYS) issue('endDate', `Time off can last up to ${MAX_DAYS} days`);
    if (v.isAllDay) return;
    if (!v.startTime) issue('startTime', 'Choose a start time');
    if (!v.endTime) issue('endTime', 'Choose an end time');
    if (span === 1 && v.startTime && v.endTime && v.startTime >= v.endTime)
      issue('endTime', 'The end must be after the start');
  });

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(t?: TherapistTimeOff | null): Values {
  return {
    startDate: t?.startDate ?? '',
    endDate: t?.endDate ?? '',
    isAllDay: t?.isAllDay ?? true,
    startTime: t?.startTime ?? '',
    endTime: t?.endTime ?? '',
    reason: t?.reason ?? '',
    note: t?.note ?? '',
  };
}

/** Bookings overlap the saved time off: say so, and leave resolving them to staff. */
function announceConflicts(result: TimeOffResult) {
  const n = result.conflictingAppointments?.length ?? 0;
  if (n) {
    toast.warning(
      `${n} existing appointment${n > 1 ? 's overlap' : ' overlaps'} this time off. They haven’t been changed: reschedule or cancel them from Appointments.`,
    );
  }
}

export function TimeOffDialog({
  therapistId,
  open,
  onOpenChange,
  timeOff,
}: {
  therapistId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeOff: TherapistTimeOff | null;
}) {
  const add = useAddTimeOff();
  const update = useUpdateTimeOff();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError, setValue, getValues } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const isAllDay = useWatch({ control, name: 'isAllDay' });
  const startDate = useWatch({ control, name: 'startDate' });

  React.useEffect(() => {
    if (open) reset(toValues(timeOff));
  }, [open, timeOff, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      startDate: values.startDate,
      endDate: values.endDate,
      isAllDay: values.isAllDay,
      startTime: values.isAllDay ? null : values.startTime,
      endTime: values.isAllDay ? null : values.endTime,
      reason: (values.reason || null) as TimeOffReason | null,
      note: values.note,
    };
    try {
      const result = timeOff
        ? await update.mutateAsync({ id: therapistId, timeOffId: timeOff.id, input })
        : await add.mutateAsync({ id: therapistId, input });
      toast.success(timeOff ? 'Time off saved' : 'Time off added');
      announceConflicts(result);
      onOpenChange(false);
    } catch (error) {
      showFormError(error, setError, FIELDS);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{timeOff ? 'Edit time off' : 'Add time off'}</DialogTitle>
            <DialogDescription>
              New bookings won’t be offered during this time. Appointments already booked aren’t
              cancelled or moved.
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={control}
            name="isAllDay"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">All day</span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <Field
                  label={isAllDay ? 'From' : 'Start date'}
                  required
                  error={errors.startDate?.message}
                >
                  <DatePicker
                    value={field.value || undefined}
                    onChange={(v) => {
                      field.onChange(v ?? '');
                      const end = getValues('endDate');
                      if (v && (!end || end < v))
                        setValue('endDate', v, { shouldValidate: Boolean(end) });
                    }}
                  />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="endDate"
              render={({ field }) => (
                <Field
                  label={isAllDay ? 'To' : 'End date'}
                  required
                  error={errors.endDate?.message}
                >
                  <DatePicker
                    value={field.value || undefined}
                    onChange={(v) => field.onChange(v ?? '')}
                    disabledDays={startDate ? { before: parseISO(startDate) } : undefined}
                  />
                </Field>
              )}
            />
            {!isAllDay && (
              <>
                <Controller
                  control={control}
                  name="startTime"
                  render={({ field }) => (
                    <Field label="Start time" required error={errors.startTime?.message}>
                      <TimePicker
                        value={field.value || undefined}
                        onChange={field.onChange}
                        min="00:00"
                        max="23:45"
                        step={15}
                        placeholder="Start"
                      />
                    </Field>
                  )}
                />
                <Controller
                  control={control}
                  name="endTime"
                  render={({ field }) => (
                    <Field label="End time" required error={errors.endTime?.message}>
                      <TimePicker
                        value={field.value || undefined}
                        onChange={field.onChange}
                        min="00:15"
                        max="23:45"
                        step={15}
                        placeholder="End"
                      />
                    </Field>
                  )}
                />
              </>
            )}
          </div>
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <Field label="Reason" optional error={errors.reason?.message}>
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIME_OFF_REASONS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Field label="Note" optional error={errors.note?.message}>
            <Textarea
              rows={2}
              placeholder="e.g. Covering therapist arranged"
              {...register('note')}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={Boolean(timeOff) && !isDirty}>
              {timeOff ? 'Save changes' : 'Add time off'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeOffStateBadge({ timeOff }: { timeOff: TherapistTimeOff }) {
  if (timeOff.state === 'ongoing')
    return <StatusBadge def={{ label: 'Away now', tone: 'warning', icon: CalendarOff }} />;
  if (timeOff.state === 'upcoming')
    return <StatusBadge def={{ label: 'Upcoming', tone: 'info', icon: CalendarClock }} />;
  return <StatusBadge def={{ label: 'Past', tone: 'neutral', icon: History }} />;
}

export function describeTimeOff(t: TherapistTimeOff, display: Display) {
  const date = (v: string) => formatCenterDate(v, display.dateFormat);
  const clock = (v: string) => formatCenterClock(v, display.timeFormat);
  if (t.isAllDay) {
    return t.startDate === t.endDate
      ? { range: date(t.startDate), detail: 'All day' }
      : { range: `${date(t.startDate)} – ${date(t.endDate)}`, detail: 'All day' };
  }
  if (t.startDate === t.endDate) {
    return { range: date(t.startDate), detail: `${clock(t.startTime!)} – ${clock(t.endTime!)}` };
  }
  return {
    range: `${date(t.startDate)} ${clock(t.startTime!)} – ${date(t.endDate)} ${clock(t.endTime!)}`,
    detail: 'Part days',
  };
}

function TimeOffTable({
  therapistId,
  period,
  display,
  editable,
  onEdit,
  onAdd,
}: {
  therapistId: string;
  period: 'upcoming' | 'past';
  display: Display;
  editable: boolean;
  onEdit: (t: TherapistTimeOff) => void;
  onAdd?: () => void;
}) {
  const { data, isPending, error, refetch } = useTherapistTimeOff(therapistId, period);
  const remove = useRemoveTimeOff();
  const [deleting, setDeleting] = React.useState<TherapistTimeOff | null>(null);

  const columns = React.useMemo<ColumnDef<TherapistTimeOff, unknown>[]>(
    () =>
      (
        [
          {
            id: 'when',
            header: 'When',
            cell: ({ row }) => {
              const { range, detail } = describeTimeOff(row.original, display);
              return (
                <div className="flex flex-col">
                  <span className="tabular">{range}</span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                </div>
              );
            },
          },
          {
            id: 'reason',
            header: 'Reason',
            cell: ({ row }) => (
              <div className="flex min-w-0 flex-col">
                <span>
                  {row.original.reason ? TIME_OFF_REASONS[row.original.reason] : 'Time off'}
                </span>
                {row.original.note && (
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {row.original.note}
                  </span>
                )}
              </div>
            ),
          },
          {
            id: 'state',
            header: 'Status',
            meta: { className: 'hidden sm:table-cell' },
            cell: ({ row }) => <TimeOffStateBadge timeOff={row.original} />,
          },
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) =>
              editable ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Time off actions">
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => onEdit(row.original)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem tone="danger" onSelect={() => setDeleting(row.original)}>
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null,
          },
        ] satisfies ColumnDef<TherapistTimeOff, unknown>[]
      ).map((c) => ({ ...c, enableSorting: false })),
    [display, editable, onEdit],
  );

  return (
    <>
      <DataTable
        label={period === 'upcoming' ? 'Upcoming time off' : 'Past time off'}
        columns={columns}
        data={data}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(t) => t.id}
        className="shadow-none"
        empty={
          period === 'upcoming' ? (
            <EmptyState
              compact
              icon={CalendarX2}
              title="No upcoming time off"
              description="Leave, training or other absences go here, so they can’t be booked."
              action={
                onAdd && (
                  <Button size="sm" onClick={onAdd}>
                    <Plus /> Add time off
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState compact icon={History} title="No past time off" />
          )
        }
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this time off?"
        description="The therapist will be bookable again during this time, within their regular hours."
        confirmLabel="Remove time off"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(
            { id: therapistId, timeOffId: deleting.id },
            {
              onSuccess: () => {
                toast.success('Time off removed');
                setDeleting(null);
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      />
    </>
  );
}

/** Upcoming and past time off, with add/edit/remove for those allowed to manage it. */
export function TimeOffPanel({
  therapistId,
  openNew = false,
}: {
  therapistId: string;
  /** Opens the add dialog straight away, e.g. from a list's "Add time off" action */
  openNew?: boolean;
}) {
  const { can } = useSession();
  const editable = can('therapists.manage_time_off');
  const general = useGeneralSettings();
  const display: Display = general.data ?? { dateFormat: 'D_MMM_YYYY', timeFormat: 'H12' };
  const [dialog, setDialog] = React.useState<{ timeOff: TherapistTimeOff | null } | null>(
    openNew && editable ? { timeOff: null } : null,
  );
  const onEdit = React.useCallback((timeOff: TherapistTimeOff) => setDialog({ timeOff }), []);
  const onAdd = editable ? () => setDialog({ timeOff: null }) : undefined;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Time off</CardTitle>
        {onAdd && (
          <Button size="sm" onClick={onAdd}>
            <Plus /> Add time off
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upcoming" className="gap-3">
          <SegmentedList>
            <SegmentedTrigger value="upcoming">Upcoming</SegmentedTrigger>
            <SegmentedTrigger value="past">Past</SegmentedTrigger>
          </SegmentedList>
          {(['upcoming', 'past'] as const).map((period) => (
            <TabsContent key={period} value={period}>
              <TimeOffTable
                therapistId={therapistId}
                period={period}
                display={display}
                editable={editable}
                onEdit={onEdit}
                onAdd={period === 'upcoming' ? onAdd : undefined}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
      {editable && (
        <TimeOffDialog
          therapistId={therapistId}
          open={Boolean(dialog)}
          onOpenChange={(o) => !o && setDialog(null)}
          timeOff={dialog?.timeOff ?? null}
        />
      )}
    </Card>
  );
}
