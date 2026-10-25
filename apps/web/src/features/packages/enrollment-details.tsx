'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  CalendarCheck2,
  CircleCheck,
  CircleDot,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  Ticket,
  TicketCheck,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { KpiCard } from '@/components/domain/kpi-card';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import {
  useAdjustEnrollment,
  useCancelEnrollment,
  useEnrollment,
  useEnrollmentLedger,
} from '@/lib/api/packages';
import type { AdjustmentType, EnrollmentDetail, EnrollmentMovement } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import { appointmentLinks } from '../appointments/appointment-display';
import {
  ACTIVATION_POLICIES,
  CHARGE_REASONS,
  DISCOUNT_TYPES,
  ENROLLMENT_STATUSES,
  EnrollmentStatusBadge,
  MOVEMENTS,
  RELEASE_REASONS,
  formatMoney,
  packageLinks,
  useInstant,
  usageLimitText,
  validityText,
} from './package-display';

function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={cn('grid gap-0.5', className)}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', empty && 'text-subtle-foreground')}>{empty ? '—' : children}</dd>
    </div>
  );
}

const ADJUSTMENTS: Record<AdjustmentType, { label: string; description: string }> = {
  BONUS_CREDIT: { label: 'Bonus sessions', description: 'Courtesy sessions added to the balance' },
  MANUAL_CREDIT: { label: 'Credit sessions', description: 'A correction in the patient’s favour' },
  MANUAL_DEBIT: {
    label: 'Debit sessions',
    description: 'A correction against the balance; never more than is unbooked',
  },
  CONSUMPTION_REVERSAL: {
    label: 'Reverse a charged session',
    description: 'Gives back one session that shouldn’t have been used',
  },
};

function AdjustDialog({
  enrollment: e,
  open,
  onClose,
}: {
  enrollment: EnrollmentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const ledger = useEnrollmentLedger(e.id, open);
  const mutation = useAdjustEnrollment();
  const cancelled = e.status === 'CANCELLED';
  const [type, setType] = React.useState<AdjustmentType>(
    cancelled ? 'CONSUMPTION_REVERSAL' : 'BONUS_CREDIT',
  );
  const [quantity, setQuantity] = React.useState('1');
  const [consumptionId, setConsumptionId] = React.useState('');
  const [reason, setReason] = React.useState('');
  // One key per opening: a double click records the adjustment once.
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const charged = (ledger.data?.items ?? []).filter(
    (m) => m.type === 'SESSION_CONSUMPTION' && !m.reversed,
  );
  const close = () => {
    mutation.reset();
    setReason('');
    setQuantity('1');
    setConsumptionId('');
    setRequestId(crypto.randomUUID());
    onClose();
  };
  const reversal = type === 'CONSUMPTION_REVERSAL';
  const qty = Number(quantity);
  const valid =
    reason.trim().length >= 3 &&
    (reversal ? Boolean(consumptionId) : Number.isInteger(qty) && qty >= 1 && qty <= 100);
  const submit = () =>
    mutation.mutate(
      {
        id: e.id,
        input: {
          type,
          reason: reason.trim(),
          requestId,
          ...(reversal ? { consumptionId } : { quantity: qty }),
        },
      },
      {
        onSuccess: () => {
          toast.success(reversal ? 'Session given back' : 'Balance adjusted');
          close();
        },
        onError: (err) => {
          if (!(isApiError(err) && err.errors)) toast.error(err.message);
        },
      },
    );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust sessions</DialogTitle>
          <DialogDescription>
            Every adjustment is kept in the usage history with your name and reason. It changes
            sessions only, never money: refunds are handled in billing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Adjustment" required>
            <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ADJUSTMENTS).map(([value, a]) => (
                  <SelectItem
                    key={value}
                    value={value}
                    disabled={cancelled && value !== 'CONSUMPTION_REVERSAL'}
                  >
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="-mt-2 text-[13px] text-muted-foreground">{ADJUSTMENTS[type].description}</p>
          {reversal ? (
            <Field
              label="Charged session"
              required
              error={errors.consumptionId}
              helper={
                ledger.data && !charged.length ? 'No charged sessions to reverse.' : undefined
              }
            >
              <Select value={consumptionId} onValueChange={setConsumptionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a session" />
                </SelectTrigger>
                <SelectContent>
                  {charged.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.appointment
                        ? `${fmt.date(m.appointment.date)}, ${fmt.clock(m.appointment.startTime)} · ${m.appointment.therapyType.code}`
                        : instant(m.at)}
                      {m.chargeReason && ` · ${CHARGE_REASONS[m.chargeReason]}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              label="Sessions"
              required
              error={errors.quantity}
              helper={
                type === 'MANUAL_DEBIT'
                  ? `${e.sessions.availableToBook} unbooked session${e.sessions.availableToBook === 1 ? '' : 's'} can be debited`
                  : undefined
              }
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={quantity}
                onChange={(ev) => setQuantity(ev.target.value)}
                className="w-28 tabular"
              />
            </Field>
          )}
          <Field label="Reason" required error={errors.reason}>
            <Textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
          {isApiError(mutation.error) && !mutation.error.errors && (
            <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} loading={mutation.isPending}>
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  enrollment: e,
  open,
  onClose,
}: {
  enrollment: EnrollmentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useCancelEnrollment();
  const [reason, setReason] = React.useState('');
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const close = () => {
    mutation.reset();
    setReason('');
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {e.code}?</DialogTitle>
          <DialogDescription>
            No more sessions can be used.
            {e.sessions.reserved > 0 &&
              ` ${e.sessions.reserved} booked session${e.sessions.reserved === 1 ? ' stays' : 's stay'} booked, without a package.`}{' '}
            Used sessions and the history are kept. Refunds, if any, are handled in billing.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        {isApiError(mutation.error) && !mutation.error.errors && (
          <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Keep enrollment
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: e.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Enrollment cancelled');
                    close();
                  },
                  onError: (err) => {
                    if (!(isApiError(err) && err.errors)) toast.error(err.message);
                  },
                },
              )
            }
          >
            Cancel enrollment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function movementDetail(m: EnrollmentMovement) {
  if (m.chargeReason) return CHARGE_REASONS[m.chargeReason];
  if (m.releaseReason) return RELEASE_REASONS[m.releaseReason];
  return m.reason;
}

function UsageHistory({ enrollment: e }: { enrollment: EnrollmentDetail }) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const { data, isFetching, error, refetch } = useEnrollmentLedger(e.id);
  const columns: ColumnDef<EnrollmentMovement, unknown>[] = [
    {
      id: 'at',
      header: 'When',
      meta: { className: 'whitespace-nowrap tabular text-[13px]' },
      cell: ({ row }) => instant(row.original.at),
    },
    {
      id: 'movement',
      header: 'Movement',
      cell: ({ row }) => {
        const m = row.original;
        return (
          <span className="flex flex-col">
            <span className={cn('font-medium', m.reversed && 'line-through decoration-1')}>
              {MOVEMENTS[m.type]}
            </span>
            {movementDetail(m) && (
              <span className="text-xs text-muted-foreground">{movementDetail(m)}</span>
            )}
          </span>
        );
      },
    },
    {
      id: 'sessions',
      header: 'Sessions',
      meta: { className: 'tabular text-right whitespace-nowrap' },
      cell: ({ row }) => {
        const m = row.original;
        if (m.type === 'SESSION_RESERVED')
          return <span className="text-info-foreground">held</span>;
        if (m.type === 'RESERVATION_RELEASED')
          return <span className="text-muted-foreground">freed</span>;
        return (
          <span className={m.quantity < 0 ? 'text-foreground' : 'text-success-foreground'}>
            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
          </span>
        );
      },
    },
    {
      id: 'appointment',
      header: 'Appointment',
      meta: { className: 'hidden md:table-cell' },
      cell: ({ row }) => {
        const a = row.original.appointment;
        if (!a) return <span className="text-subtle-foreground">—</span>;
        return (
          <Link
            href={appointmentLinks.detail(a.id)}
            className="inline-flex items-center gap-2 rounded text-[13px] hover:underline focus-ring"
          >
            {fmt.date(a.date)}, {fmt.clock(a.startTime)}
            <TherapyTypeChip therapyType={a.therapyType} />
          </Link>
        );
      },
    },
    {
      id: 'by',
      header: 'By',
      meta: { className: 'hidden lg:table-cell text-[13px]' },
      cell: ({ row }) => row.original.by?.fullName ?? '—',
    },
  ];
  return (
    <DataTable
      label="Usage history"
      columns={columns}
      data={data?.items}
      loading={isFetching}
      error={error}
      onRetry={() => void refetch()}
      getRowId={(m) => m.id}
      toolbar={
        <div>
          <h2 className="text-card-title">Usage history</h2>
          <p className="text-[13px] text-muted-foreground">
            Every change to the balance, oldest first. Entries are never edited or removed.
          </p>
        </div>
      }
      empty={<EmptyState compact title="Nothing has happened yet." />}
    />
  );
}

type DialogKind = 'adjust' | 'cancel' | null;

function EnrollmentPage() {
  const { id } = useParams<{ id: string }>();
  const query = useEnrollment(id);
  const fmt = useCenterFormat();
  const instant = useInstant();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useBreadcrumbLabel(id, query.data?.code);

  // ?action=adjust|cancel from list menus opens the matching dialog, if allowed. It's
  // read whenever it changes, not just on mount: visited routes keep their state.
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const requested = search.get('action');
  const e = query.data;
  const [handled, setHandled] = React.useState<string | null>(null);
  if (e && requested !== handled) {
    setHandled(requested);
    if (requested === 'adjust' && e.actions.adjust) setDialog('adjust');
    if (requested === 'cancel' && e.actions.cancel) setDialog('cancel');
  }
  const close = () => {
    setDialog(null);
    if (requested) router.replace(pathname, { scroll: false });
  };
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setDialog(null), []);

  if (query.isPending) return <PageSkeleton />;
  if (query.error || !e) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={Ticket}
            title="Enrollment not found"
            description="The link may be wrong, or it belongs to another center."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={packageLinks.enrollments}>Back to enrollments</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }

  const s = e.sessions;
  const extra = s.additionalCredits - s.manualDebits;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: packageLinks.enrollments, label: 'Enrollments' }}
        title={e.package.name}
        description={
          <>
            <span className="tabular">{e.code}</span> ·{' '}
            <Link href={`/patients/${e.patient.id}?tab=packages`} className="hover:underline">
              {e.patient.fullName}
            </Link>{' '}
            <span className="text-muted-foreground">({e.patient.code})</span>
          </>
        }
        meta={
          <>
            <EnrollmentStatusBadge status={e.status} />
            <span className="text-[13px] text-muted-foreground">
              {ENROLLMENT_STATUSES[e.status].description}
            </span>
          </>
        }
        actions={
          <>
            {e.actions.renew && (
              <Button asChild>
                <Link href={packageLinks.enroll({ renew: e.id })}>
                  <RefreshCw /> Renew
                </Link>
              </Button>
            )}
            {e.actions.adjust && (
              <Button variant="secondary" onClick={() => setDialog('adjust')}>
                <SlidersHorizontal /> Adjust sessions
              </Button>
            )}
            {e.actions.cancel && (
              <Button variant="danger-ghost" onClick={() => setDialog('cancel')}>
                <Ban /> Cancel
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Total sessions"
          value={s.total}
          hint={
            extra
              ? `${s.purchased} purchased, ${extra > 0 ? '+' : ''}${extra} adjusted`
              : `${s.purchased} purchased`
          }
          icon={Layers}
        />
        <KpiCard
          label="Used"
          value={s.consumed}
          hint={s.reversed ? `${s.reversed} reversed` : undefined}
          icon={TicketCheck}
        />
        <KpiCard
          label="Booked"
          value={s.reserved}
          hint="Reserved, not used"
          icon={CalendarCheck2}
        />
        <KpiCard label="Remaining" value={s.remaining} icon={CircleDot} tone="primary" />
        <KpiCard
          label="Free to book"
          value={s.availableToBook}
          icon={CircleCheck}
          tone={s.availableToBook > 0 ? 'success' : 'warning'}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Package terms</CardTitle>
            <CardDescription>
              As agreed when enrolled. Later changes to the catalog don’t apply.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Valid">
                {e.startDate && e.endDate
                  ? `${fmt.date(e.startDate)} – ${fmt.date(e.endDate)}`
                  : 'From the first session'}
              </Detail>
              <Detail label="Validity">
                {validityText(e.terms.validity.value, e.terms.validity.unit)}
                {e.customEndDate && ' (end date set by hand)'}
              </Detail>
              <Detail label="Starts">{ACTIVATION_POLICIES[e.activationPolicy].label}</Detail>
              <Detail label="Therapies" className="sm:col-span-3">
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {e.therapyTypes.map((t) => (
                    <TherapyTypeChip key={t.id} therapyType={t} full />
                  ))}
                  {e.therapyTypes.length > 1 && (
                    <span className="text-[13px] text-muted-foreground">(shared sessions)</span>
                  )}
                </span>
              </Detail>
              <Detail label="Usage limit">{usageLimitText(e.terms.usageLimit) ?? 'None'}</Detail>
              <Detail label="Charged for" className="sm:col-span-2">
                {[
                  'Completed sessions',
                  e.terms.chargeNoShow && 'no-shows',
                  e.terms.chargeLateCancellation && 'late cancellations',
                ]
                  .filter(Boolean)
                  .join(', ')}
                {e.terms.coversAssessments ? '; covers assessments' : '; therapy sessions only'}
              </Detail>
              {e.therapyPlan && (
                <Detail label="Therapy plan" className="sm:col-span-3">
                  <Link href={`/therapy-plans/${e.therapyPlan.id}`} className="hover:underline">
                    {e.therapyPlan.code} · {e.therapyPlan.title}
                  </Link>
                </Detail>
              )}
              {e.notes && (
                <Detail label="Notes" className="sm:col-span-3">
                  <span className="whitespace-pre-line">{e.notes}</span>
                </Detail>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Agreed price</CardTitle>
            <CardDescription>
              Not a payment record: payments are tracked in billing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Detail label="Catalog price">
                {formatMoney(e.pricing.catalogPrice, e.currency)}
              </Detail>
              <Detail label="Discount">
                {e.pricing.discountType === 'NONE'
                  ? 'None'
                  : `${DISCOUNT_TYPES[e.pricing.discountType]}${
                      e.pricing.discountType === 'PERCENTAGE'
                        ? ` (${e.pricing.discountValue}%)`
                        : ''
                    }: ${formatMoney(e.pricing.discountAmount, e.currency)} off`}
              </Detail>
              <Detail label="Final price">
                <span className="text-lg font-semibold tabular">
                  {formatMoney(e.pricing.finalPrice, e.currency)}
                </span>
              </Detail>
              <Detail label="Enrolled">
                {instant(e.createdAt)} by {e.createdBy.fullName}
              </Detail>
              {e.renewedFrom && (
                <Detail label="Renews">
                  <Link
                    href={packageLinks.enrollment(e.renewedFrom.id)}
                    className="hover:underline"
                  >
                    {e.renewedFrom.code}
                  </Link>
                </Detail>
              )}
              {e.renewals.length > 0 && (
                <Detail label="Renewed as">
                  {e.renewals.map((r, i) => (
                    <React.Fragment key={r.id}>
                      {i > 0 && ', '}
                      <Link href={packageLinks.enrollment(r.id)} className="hover:underline">
                        {r.code}
                      </Link>
                    </React.Fragment>
                  ))}
                </Detail>
              )}
              {e.status === 'CANCELLED' && (
                <Detail label="Cancelled">
                  {e.cancelledAt && instant(e.cancelledAt)}
                  {e.cancelledBy && ` by ${e.cancelledBy.fullName}`}
                  {e.cancellationReason && `: ${e.cancellationReason}`}
                </Detail>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      {e.upcoming.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Booked sessions</CardTitle>
            <CardDescription>
              Each holds one session until it’s completed (used) or cancelled (freed).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {e.upcoming.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link
                    href={appointmentLinks.detail(a.id)}
                    className="rounded text-sm font-medium hover:underline focus-ring"
                  >
                    {fmt.date(a.date)}, {fmt.clock(a.startTime)}
                  </Link>
                  <span className="flex items-center gap-3 text-[13px] text-muted-foreground">
                    <TherapyTypeChip therapyType={a.therapyType} />
                    {a.therapist.fullName}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <UsageHistory enrollment={e} />

      <AdjustDialog enrollment={e} open={dialog === 'adjust'} onClose={close} />
      <CancelDialog enrollment={e} open={dialog === 'cancel'} onClose={close} />
    </div>
  );
}

export function EnrollmentDetailsScreen() {
  return (
    <RequirePermission permission="package_enrollments.read">
      <EnrollmentPage />
    </RequirePermission>
  );
}
