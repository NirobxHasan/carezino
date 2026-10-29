'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Ban, Banknote, FileText, Pencil, Printer, Send, Trash2, Wallet } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  useApplyCredit,
  useDiscardInvoice,
  useInvoice,
  useIssueInvoice,
  useReleaseAllocation,
  useVoidInvoice,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { InvoiceDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { appointmentLinks, useCenterFormat } from '../appointments/appointment-display';
import { packageLinks, useInstant } from '../packages/package-display';
import { useCollectPaymentDialog } from './collect-payment';
import {
  Amount,
  HISTORY_ACTIONS,
  ITEM_KINDS,
  InvoiceStatusBadge,
  RELEASE_REASONS,
  compareMoney,
  financeLinks,
  formatMoney,
  isPositive,
} from './finance-display';

function Total({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4 text-sm',
        strong && 'text-base font-semibold',
        className,
      )}
    >
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function VoidDialog({
  invoice: i,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { can } = useSession();
  const mutation = useVoidInvoice();
  const [reason, setReason] = React.useState('');
  const [reissue, setReissue] = React.useState(true);
  const close = () => {
    mutation.reset();
    setReason('');
    onClose();
  };
  const paid = isPositive(i.paidAmount);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {i.number}?</DialogTitle>
          <DialogDescription>
            It stays on record, marked void, and nothing is owed on it any more.
            {paid &&
              ` The ${formatMoney(i.paidAmount, i.currency)} paid on it becomes ${i.patient.fullName}’s credit, to apply to another invoice or refund.`}{' '}
            Packages and sessions aren’t changed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field
            label="Reason"
            required
            error={isApiError(mutation.error) ? mutation.error.errors?.reason : undefined}
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {can('invoices.create') && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={reissue}
                onCheckedChange={(c) => setReissue(c === true)}
                className="mt-0.5"
              />
              <span>
                Start a corrected copy as a draft
                <span className="block text-xs text-muted-foreground">
                  Same lines, ready to edit and issue again.
                </span>
              </span>
            </label>
          )}
          {isApiError(mutation.error) && !mutation.error.errors && (
            <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Keep invoice
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: i.id, reason: reason.trim(), reissue: reissue && can('invoices.create') },
                {
                  onSuccess: (r) => {
                    toast.success(`${i.number} voided`);
                    close();
                    if (r.reissueId) router.push(financeLinks.editInvoice(r.reissueId));
                  },
                },
              )
            }
          >
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyCreditDialog({
  invoice: i,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useApplyCredit();
  const suggested =
    compareMoney(i.patientCredit, i.outstanding) < 0 ? i.patientCredit : i.outstanding;
  const [amount, setAmount] = React.useState(suggested);
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const close = () => {
    mutation.reset();
    setRequestId(crypto.randomUUID());
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply credit to {i.number}</DialogTitle>
          <DialogDescription>
            {i.patient.fullName} has {formatMoney(i.patientCredit, i.currency)} of unapplied credit;{' '}
            {formatMoney(i.outstanding, i.currency)} is owed on this invoice. Earlier payments are
            used first.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Amount"
          required
          error={
            isApiError(mutation.error)
              ? (mutation.error.errors?.amount ?? mutation.error.message)
              : undefined
          }
        >
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-40 tabular"
          />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!isPositive(amount)}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: i.id, amount, requestId },
                {
                  onSuccess: () => {
                    toast.success(`${formatMoney(amount, i.currency)} of credit applied`);
                    close();
                  },
                },
              )
            }
          >
            Apply credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Takes a payment off this invoice, with a reason; the money becomes credit again. */
export function ReleaseDialog({
  target,
  onClose,
}: {
  target: { paymentId: string; allocationId: string; label: string; amount: string } | null;
  onClose: () => void;
}) {
  const mutation = useReleaseAllocation();
  const [reason, setReason] = React.useState('');
  const close = () => {
    mutation.reset();
    setReason('');
    onClose();
  };
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Take {target && formatMoney(target.amount)} off {target?.label}?
          </DialogTitle>
          <DialogDescription>
            For money applied to the wrong invoice. The record is kept, marked with your reason, and
            the money becomes the patient’s credit again, to apply where it belongs.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Reason"
          required
          error={isApiError(mutation.error) ? mutation.error.message : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              target &&
              mutation.mutate(
                { id: target.paymentId, allocationId: target.allocationId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Taken off the invoice; it’s credit again');
                    close();
                  },
                },
              )
            }
          >
            Take it off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DialogKind = 'void' | 'credit' | 'issue' | 'discard' | null;

function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const query = useInvoice(id);
  const router = useRouter();
  const fmt = useCenterFormat();
  const instant = useInstant();
  const [collect, collectDialog] = useCollectPaymentDialog();
  const issue = useIssueInvoice();
  const discard = useDiscardInvoice();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [release, setRelease] = React.useState<{
    paymentId: string;
    allocationId: string;
    label: string;
    amount: string;
  } | null>(null);
  useBreadcrumbLabel(id, query.data ? (query.data.number ?? 'Draft') : undefined);
  React.useLayoutEffect(
    () => () => {
      setDialog(null);
      setRelease(null);
    },
    [],
  );

  const i = query.data;

  if (query.isPending) return <PageSkeleton />;
  if (query.error || !i) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={FileText}
            title="Invoice not found"
            description="It may have been a discarded draft, or it belongs to another center."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={financeLinks.invoices}>Back to invoices</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }

  const a = i.actions;
  const draft = i.status === 'DRAFT';
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: financeLinks.invoices, label: 'Invoices' }}
        title={i.number ?? 'Draft invoice'}
        description={
          <>
            <Link href={financeLinks.patientBilling(i.patient.id)} className="hover:underline">
              {i.patient.fullName}
            </Link>{' '}
            <span className="text-muted-foreground">({i.patient.code})</span>
            {i.automatic && (
              <span className="text-muted-foreground"> · created by billing policy</span>
            )}
          </>
        }
        meta={<InvoiceStatusBadge status={i.status} overdue={i.overdue} />}
        actions={
          <>
            {a.collect && (
              <Button onClick={() => collect({ patient: i.patient, invoiceId: i.id })}>
                <Banknote /> Collect payment
              </Button>
            )}
            {a.applyCredit && (
              <Button variant="secondary" onClick={() => setDialog('credit')}>
                <Wallet /> Apply credit
              </Button>
            )}
            {a.issue && (
              <Button onClick={() => setDialog('issue')}>
                <Send /> Issue
              </Button>
            )}
            {a.edit && (
              <Button variant="secondary" asChild>
                <Link href={financeLinks.editInvoice(i.id)}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link href={financeLinks.printInvoice(i.id)}>
                <Printer /> Print
              </Link>
            </Button>
            {a.discard && (
              <Button variant="danger-ghost" onClick={() => setDialog('discard')}>
                <Trash2 /> Discard
              </Button>
            )}
            {a.void && (
              <Button variant="danger-ghost" onClick={() => setDialog('void')}>
                <Ban /> Void
              </Button>
            )}
          </>
        }
      />

      {i.status === 'VOID' && (
        <p className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          Voided {i.voidedAt && instant(i.voidedAt)}
          {i.voidedBy && ` by ${i.voidedBy.fullName}`}: {i.voidReason}
          {i.reissues.length > 0 && (
            <>
              {' '}
              Replaced by{' '}
              {i.reissues.map((r) => (
                <Link
                  key={r.id}
                  href={financeLinks.invoice(r.id)}
                  className="font-medium hover:underline"
                >
                  {r.number ?? 'a draft'}
                </Link>
              ))}
              .
            </>
          )}
        </p>
      )}
      {i.reissuedFrom && (
        <p className="mb-4 text-[13px] text-muted-foreground">
          Reissue of{' '}
          <Link href={financeLinks.invoice(i.reissuedFrom.id)} className="hover:underline">
            {i.reissuedFrom.number}
          </Link>
          .
        </p>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>
              {draft
                ? 'Prices are checked and totals recalculated when it’s issued.'
                : 'Fixed when issued; later price changes don’t touch them.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Qty</th>
                  <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">
                    Unit price
                  </th>
                  <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">
                    Discount
                  </th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {i.items.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <span className={cn('block', !l.active && 'line-through decoration-1')}>
                        {l.description}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ITEM_KINDS[l.kind]}
                        {l.packageEnrollment && (
                          <>
                            {' · '}
                            <Link
                              href={packageLinks.enrollment(l.packageEnrollment.id)}
                              className="hover:underline"
                            >
                              {l.packageEnrollment.code}
                            </Link>
                          </>
                        )}
                        {l.appointment && (
                          <>
                            {' · '}
                            <Link
                              href={appointmentLinks.detail(l.appointment.id)}
                              className="hover:underline"
                            >
                              {fmt.date(l.appointment.date)}, {l.appointment.therapist.fullName}
                            </Link>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular">{l.quantity}</td>
                    <td className="hidden py-2.5 pr-3 text-right sm:table-cell">
                      <Amount value={l.unitPrice} currency={i.currency} />
                    </td>
                    <td className="hidden py-2.5 pr-3 text-right sm:table-cell">
                      <Amount value={l.discountAmount} currency={i.currency} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Amount value={l.totalAmount} currency={i.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {i.notes && (
              <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{i.notes}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
            <CardDescription>
              {fmt.date(i.invoiceDate)}
              {i.dueDate ? ` · due ${fmt.date(i.dueDate)}` : ' · no due date'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-1.5">
              <Total label="Subtotal" value={formatMoney(i.subtotal, i.currency)} />
              {isPositive(i.discountAmount) && (
                <Total
                  label={
                    i.invoiceDiscount?.type === 'PERCENTAGE'
                      ? `Discounts (incl. ${i.invoiceDiscount.value}% off)`
                      : 'Discounts'
                  }
                  value={`−${formatMoney(i.discountAmount, i.currency)}`}
                />
              )}
              {isPositive(i.taxAmount) && (
                <Total
                  label={`${i.taxLabel ?? 'Tax'} (${i.taxRate}%)`}
                  value={formatMoney(i.taxAmount, i.currency)}
                />
              )}
              <Total
                label="Total"
                value={formatMoney(i.totalAmount, i.currency)}
                strong
                className="mt-1 border-t border-border pt-2"
              />
              <Total label="Paid" value={formatMoney(i.paidAmount, i.currency)} />
              <Total
                label="Outstanding"
                value={formatMoney(i.outstanding, i.currency)}
                strong
                className={i.overdue ? 'text-danger-foreground' : undefined}
              />
            </dl>
            {isPositive(i.patientCredit) && (
              <p className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-[13px] text-warning-foreground">
                {i.patient.fullName} has {formatMoney(i.patientCredit, i.currency)} of unapplied
                credit.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Created {instant(i.createdAt)} by {i.createdBy.fullName}
              {i.issuedAt &&
                i.issuedBy &&
                `; issued ${instant(i.issuedAt)} by ${i.issuedBy.fullName}`}
              .
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Payments applied</CardTitle>
          <CardDescription>
            Each payment keeps its own receipt. Amounts taken off stay listed, struck through.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {i.allocations.length ? (
            <ul className="divide-y divide-border">
              {i.allocations.map((al) => (
                <li
                  key={al.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="grid">
                    <Link
                      href={financeLinks.payment(al.payment.id)}
                      className={cn(
                        'text-sm font-medium hover:underline',
                        !al.active && 'line-through',
                      )}
                    >
                      {al.payment.number} · {al.payment.method.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      Received {instant(al.payment.collectedAt)}; applied by {al.createdBy.fullName}
                      {!al.active &&
                        al.releaseReason &&
                        ` · ${RELEASE_REASONS[al.releaseReason]}${al.releaseNote ? `: ${al.releaseNote}` : ''}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {al.payment.status === 'REVERSED' && <Badge>Reversed</Badge>}
                    <Amount
                      value={al.amount}
                      currency={i.currency}
                      className={!al.active ? 'line-through' : undefined}
                    />
                    {al.active && a.reallocate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRelease({
                            paymentId: al.payment.id,
                            allocationId: al.id,
                            label: i.number ?? 'this invoice',
                            amount: al.amount,
                          })
                        }
                      >
                        Take off
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {draft ? 'Payments are collected once the invoice is issued.' : 'Nothing paid yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2">
            {i.history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{HISTORY_ACTIONS[h.action] ?? h.action}</span>
                <span className="text-[13px] text-muted-foreground">
                  {instant(h.at)}
                  {h.by && ` · ${h.by.fullName}`}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <VoidDialog invoice={i} open={dialog === 'void'} onClose={() => setDialog(null)} />
      {dialog === 'credit' && (
        <ApplyCreditDialog invoice={i} open onClose={() => setDialog(null)} />
      )}
      <ReleaseDialog target={release} onClose={() => setRelease(null)} />
      <ConfirmDialog
        open={dialog === 'issue'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Issue this invoice?"
        description={`It gets its number and ${formatMoney(i.totalAmount, i.currency)} becomes owed by ${i.patient.fullName}. Its lines and prices can’t be edited after this.`}
        confirmLabel="Issue invoice"
        loading={issue.isPending}
        onConfirm={() =>
          issue.mutate(i.id, {
            onSuccess: (r) => {
              toast.success(`Invoice ${r.number} issued`);
              setDialog(null);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Discard this draft?"
        description="It was never issued, so it’s removed. What it charged for can be invoiced again."
        confirmLabel="Discard draft"
        tone="danger"
        loading={discard.isPending}
        onConfirm={() =>
          discard.mutate(i.id, {
            onSuccess: () => {
              toast.success('Draft discarded');
              setDialog(null);
              router.push(financeLinks.invoices);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
      {collectDialog}
    </div>
  );
}

export function InvoiceDetailsScreen() {
  return (
    <RequirePermission permission="invoices.read">
      <InvoicePage />
    </RequirePermission>
  );
}
