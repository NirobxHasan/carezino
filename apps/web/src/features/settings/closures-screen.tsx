'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  Ban,
  CalendarClock,
  CalendarOff,
  CalendarRange,
  CircleSlash,
  Ellipsis,
  History,
  Pencil,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { StatusBadge } from '@/components/domain/status-badges';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { TimePicker } from '@/components/forms/time-picker';
import { SectionHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useClosures,
  useCreateClosure,
  useGeneralSettings,
  useRemoveClosure,
  useUpdateClosure,
  type ClosurePeriod,
} from '@/lib/api/settings';
import { formatCenterClock, formatCenterDate } from '@/lib/format';
import { showFormError } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { LIMITS } from '@/lib/settings-limits';
import type { CenterClosure, GeneralSettings } from '@/lib/types';
import { isoDate, requiredText } from '@/lib/validation';

type Display = Pick<GeneralSettings, 'dateFormat' | 'timeFormat'>;

const schema = z
  .object({
    title: requiredText('Title').max(120),
    startDate: isoDate('Start date'),
    endDate: isoDate('End date'),
    allDay: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string().trim().max(500),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.allDay) {
      const span = differenceInCalendarDays(parseISO(v.endDate), parseISO(v.startDate)) + 1;
      if (span < 1) issue('endDate', 'The end date can’t be before the start date');
      else if (span > LIMITS.closureDays)
        issue('endDate', `A closure can last up to ${LIMITS.closureDays} days`);
      return;
    }
    if (!v.startTime) issue('startTime', 'Choose when the closure starts');
    if (!v.endTime) issue('endTime', 'Choose when the closure ends');
    if (v.startTime && v.endTime && v.startTime >= v.endTime)
      issue('endTime', 'The end time must be after the start time');
  });

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(c?: CenterClosure | null): Values {
  return {
    title: c?.title ?? '',
    startDate: c?.startDate ?? '',
    endDate: c?.endDate ?? '',
    allDay: c?.allDay ?? true,
    startTime: c?.startTime ?? '',
    endTime: c?.endTime ?? '',
    reason: c?.reason ?? '',
    isActive: c?.isActive ?? true,
  };
}

function ClosureDialog({
  open,
  onOpenChange,
  closure,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closure: CenterClosure | null;
}) {
  const create = useCreateClosure();
  const update = useUpdateClosure();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError, setValue, getValues } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const allDay = useWatch({ control, name: 'allDay' });
  const startDate = useWatch({ control, name: 'startDate' });

  React.useEffect(() => {
    if (open) reset(toValues(closure));
  }, [open, closure, reset]);

  const onSubmit = handleSubmit(async (values) => {
    // A part-day closure is a single date.
    const input = {
      title: values.title,
      startDate: values.startDate,
      endDate: values.allDay ? values.endDate : values.startDate,
      allDay: values.allDay,
      startTime: values.allDay ? null : values.startTime,
      endTime: values.allDay ? null : values.endTime,
      reason: values.reason,
      isActive: values.isActive,
    };
    try {
      if (closure) {
        await update.mutateAsync({ id: closure.id, input });
        toast.success('Closure saved');
      } else {
        await create.mutateAsync({ ...input, reason: input.reason || undefined });
        toast.success(`${values.title} added`);
      }
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
            <DialogTitle>{closure ? 'Edit closure' : 'Add closure'}</DialogTitle>
            <DialogDescription>
              New bookings won’t be offered while the center is closed. Bookings already on these
              dates aren’t moved or cancelled.
            </DialogDescription>
          </DialogHeader>
          <Field label="Title" required error={errors.title?.message}>
            <Input placeholder="e.g. Eid holidays" {...register('title')} />
          </Field>
          <Controller
            control={control}
            name="allDay"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">All day</span>
                <Switch
                  checked={field.value}
                  onCheckedChange={(v) => {
                    field.onChange(v);
                    if (!v) setValue('endDate', getValues('startDate'));
                  }}
                />
              </label>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <Field label={allDay ? 'From' : 'Date'} required error={errors.startDate?.message}>
                  <DatePicker
                    value={field.value || undefined}
                    onChange={(v) => {
                      field.onChange(v ?? '');
                      const end = getValues('endDate');
                      if (v && (!end || end < v || !getValues('allDay')))
                        setValue('endDate', v, { shouldValidate: Boolean(end) });
                    }}
                  />
                </Field>
              )}
            />
            {allDay ? (
              <Controller
                control={control}
                name="endDate"
                render={({ field }) => (
                  <Field label="To" required error={errors.endDate?.message}>
                    <DatePicker
                      value={field.value || undefined}
                      onChange={(v) => field.onChange(v ?? '')}
                      disabledDays={startDate ? { before: parseISO(startDate) } : undefined}
                    />
                  </Field>
                )}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Controller
                  control={control}
                  name="startTime"
                  render={({ field }) => (
                    <Field label="From" required error={errors.startTime?.message}>
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
                    <Field label="To" required error={errors.endTime?.message}>
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
              </div>
            )}
          </div>
          {!allDay && errors.endDate?.message && (
            <p className="text-xs text-danger-foreground">{errors.endDate.message}</p>
          )}
          <Field label="Reason" optional error={errors.reason?.message}>
            <Textarea rows={2} placeholder="e.g. National holiday" {...register('reason')} />
          </Field>
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Active</span>
                  <span className="text-xs text-muted-foreground">
                    Inactive closures are kept for reference but don’t block bookings.
                  </span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={Boolean(closure) && !isDirty}>
              {closure ? 'Save changes' : 'Add closure'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClosureStateBadge({ closure }: { closure: CenterClosure }) {
  if (!closure.isActive)
    return <StatusBadge def={{ label: 'Inactive', tone: 'neutral', icon: CircleSlash }} />;
  if (closure.state === 'ongoing')
    return <StatusBadge def={{ label: 'Closed now', tone: 'warning', icon: CalendarOff }} />;
  if (closure.state === 'upcoming')
    return <StatusBadge def={{ label: 'Upcoming', tone: 'info', icon: CalendarClock }} />;
  return <StatusBadge def={{ label: 'Past', tone: 'neutral', icon: History }} />;
}

function describeDates(c: CenterClosure, display: Display) {
  const start = formatCenterDate(c.startDate, display.dateFormat);
  if (!c.allDay && c.startTime && c.endTime) {
    const t = (v: string) => formatCenterClock(v, display.timeFormat);
    return { range: start, detail: `${t(c.startTime)} – ${t(c.endTime)}` };
  }
  if (c.days === 1) return { range: start, detail: 'All day' };
  return {
    range: `${start} – ${formatCenterDate(c.endDate, display.dateFormat)}`,
    detail: `${c.days} days`,
  };
}

function ClosuresTable({
  period,
  display,
  onEdit,
  onAdd,
}: {
  period: ClosurePeriod;
  display: Display;
  onEdit: (c: CenterClosure) => void;
  onAdd?: () => void;
}) {
  const { can } = useSession();
  const editable = can('center_settings.update');
  const { data, isPending, error, refetch } = useClosures(period);
  const update = useUpdateClosure();
  const remove = useRemoveClosure();
  const [deleting, setDeleting] = React.useState<CenterClosure | null>(null);

  const columns = React.useMemo<ColumnDef<CenterClosure, unknown>[]>(
    () =>
      (
        [
          {
            accessorKey: 'title',
            header: 'Closure',
            cell: ({ row }) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.original.title}</span>
                {row.original.reason && (
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {row.original.reason}
                  </span>
                )}
              </div>
            ),
          },
          {
            accessorKey: 'startDate',
            header: 'When',
            cell: ({ row }) => {
              const { range, detail } = describeDates(row.original, display);
              return (
                <div className="flex flex-col whitespace-nowrap">
                  <span className="tabular">{range}</span>
                  <span className="text-xs text-muted-foreground">{detail}</span>
                </div>
              );
            },
          },
          {
            id: 'status',
            header: 'Status',
            cell: ({ row }) => <ClosureStateBadge closure={row.original} />,
          },
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) => {
              const c = row.original;
              if (!editable) return null;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.title}`}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => onEdit(c)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        update.mutate(
                          { id: c.id, input: { isActive: !c.isActive } },
                          {
                            onSuccess: () =>
                              toast.success(
                                c.isActive ? `${c.title} deactivated` : `${c.title} activated`,
                              ),
                            onError: (e) => toast.error(e.message),
                          },
                        )
                      }
                    >
                      {c.isActive ? (
                        <>
                          <Ban /> Deactivate
                        </>
                      ) : (
                        <>
                          <Power /> Activate
                        </>
                      )}
                    </DropdownMenuItem>
                    {c.canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem tone="danger" onSelect={() => setDeleting(c)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          },
        ] satisfies ColumnDef<CenterClosure, unknown>[]
      ).map((column) => ({ ...column, enableSorting: false })),
    [display, editable, onEdit, update],
  );

  return (
    <>
      <DataTable
        label={period === 'upcoming' ? 'Upcoming closures' : 'Past closures'}
        columns={columns}
        data={data}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(c) => c.id}
        pageSize={20}
        empty={
          period === 'upcoming' ? (
            <EmptyState
              icon={CalendarRange}
              title="No upcoming closures"
              description="Add holidays and other days the center is shut, so they can’t be booked."
              action={
                onAdd && (
                  <Button size="sm" onClick={onAdd}>
                    <Plus /> Add closure
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState icon={History} title="No past closures" />
          )
        }
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.title}?`}
        description="It will be removed completely. To keep a record but stop it from blocking bookings, deactivate it instead."
        confirmLabel="Delete closure"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Closure deleted');
              setDeleting(null);
            },
            onError: (e) => toast.error(e.message),
          });
        }}
      />
    </>
  );
}

export function ClosuresScreen() {
  const { can } = useSession();
  const editable = can('center_settings.update');
  const general = useGeneralSettings();
  const display: Display = general.data ?? { dateFormat: 'D_MMM_YYYY', timeFormat: 'H12' };
  const [dialog, setDialog] = React.useState<{ closure: CenterClosure | null } | null>(null);
  const onEdit = React.useCallback((closure: CenterClosure) => setDialog({ closure }), []);
  const onAdd = editable ? () => setDialog({ closure: null }) : undefined;

  return (
    <RequirePermission permission="center_settings.read">
      <SectionHeader
        title="Holidays & closures"
        description="Dates the center is shut, in addition to its weekly closed days."
        actions={
          onAdd && (
            <Button onClick={onAdd}>
              <Plus /> Add closure
            </Button>
          )
        }
      />
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">
          <ClosuresTable period="upcoming" display={display} onEdit={onEdit} onAdd={onAdd} />
        </TabsContent>
        <TabsContent value="past">
          <ClosuresTable period="past" display={display} onEdit={onEdit} />
        </TabsContent>
      </Tabs>
      {editable && (
        <ClosureDialog
          open={Boolean(dialog)}
          onOpenChange={(o) => !o && setDialog(null)}
          closure={dialog?.closure ?? null}
        />
      )}
      {!editable && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge>Read only</Badge> Only center administrators can change closures.
        </p>
      )}
    </RequirePermission>
  );
}
