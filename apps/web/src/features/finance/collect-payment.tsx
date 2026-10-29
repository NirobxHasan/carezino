'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info } from 'lucide-react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  useBillingSettings,
  useCollectPayment,
  useInvoiceList,
  usePaymentMethods,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useCenterFormat } from '../appointments/appointment-display';
import {
  compareMoney,
  distribute,
  financeLinks,
  formatMoney,
  isPositive,
  subtractMoney,
  sumMoney,
  toPaisa,
} from './finance-display';

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'tabular',
          strong && 'font-semibold',
          tone === 'success' && 'text-success-foreground',
          tone === 'warning' && 'text-warning-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The front desk's payment form: choose the patient's open invoices (oldest first),
 * enter what was received and how, and it's applied oldest first; anything left over
 * is kept as the patient's credit when the center takes advance payments. Each opening
 * has its own request key, so a double click or a retry records one payment.
 */
export function CollectPaymentDialog({
  patient,
  invoiceId,
  open,
  onClose,
}: {
  patient: { id: string; fullName: string; code: string };
  /** The invoice to pay, preselected */
  invoiceId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const fmt = useCenterFormat();
  const settings = useBillingSettings(open);
  const methods = usePaymentMethods('ACTIVE', open);
  const invoices = useInvoiceList(
    {
      patientId: patient.id,
      status: ['ISSUED', 'PARTIALLY_PAID'],
      sortBy: 'invoiceDate',
      sortOrder: 'asc',
      pageSize: 50,
    },
    open,
  );
  const mutation = useCollectPayment();
  const currency = settings.data?.currency;
  const [selected, setSelected] = React.useState<string[]>([]);
  const [amount, setAmount] = React.useState('');
  const [methodId, setMethodId] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const [seeded, setSeeded] = React.useState(false);

  const open_ = invoices.data?.items ?? [];
  // Preselect the invoice asked for (or, without one, every open invoice) once loaded.
  if (open && invoices.data && !seeded) {
    setSeeded(true);
    const initial = invoiceId ? open_.filter((i) => i.id === invoiceId) : open_;
    setSelected(initial.map((i) => i.id));
    setAmount(sumMoney(initial.map((i) => i.outstanding)));
  }
  if (open && !methodId && methods.data?.items.length) {
    setMethodId(methods.data.items[0].id);
  }

  const close = () => {
    mutation.reset();
    setSelected([]);
    setAmount('');
    setReference('');
    setNotes('');
    setMethodId('');
    setSeeded(false);
    setRequestId(crypto.randomUUID());
    onClose();
  };

  const chosen = open_.filter((i) => selected.includes(i.id));
  const owed = sumMoney(chosen.map((i) => i.outstanding));
  const valid = toPaisa(amount) !== null && isPositive(amount);
  const parts = valid
    ? distribute(
        amount,
        chosen.map((i) => i.outstanding),
      )
    : [];
  const applied = sumMoney(parts);
  const excess = valid ? subtractMoney(amount, applied) : '0.00';
  const hasExcess = isPositive(excess);
  const method = methods.data?.items.find((m) => m.id === methodId);
  const advanceOff = settings.data && !settings.data.allowAdvancePayment;
  const partialOff = settings.data && !settings.data.allowPartialPayment;
  const partial = chosen.some((inv, n) => parts[n] && compareMoney(parts[n], inv.outstanding) < 0);
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};

  let problem: string | null = null;
  if (hasExcess && advanceOff) {
    problem = chosen.length
      ? `Advance payments are off: collect at most ${formatMoney(owed, currency)}.`
      : 'Advance payments are off: choose an invoice to pay.';
  } else if (partial && partialOff) {
    problem = 'Partial payments are off: collect each chosen invoice in full.';
  } else if (method?.requiresReference && !reference.trim()) {
    problem = `Enter the ${method.name} transaction ID.`;
  }
  const canSubmit = valid && Boolean(methodId) && !problem;

  const submit = () =>
    mutation.mutate(
      {
        patientId: patient.id,
        amount,
        methodId,
        transactionReference: reference.trim() || null,
        notes: notes.trim() || null,
        requestId,
        allocations: chosen
          .map((inv, n) => ({ invoiceId: inv.id, amount: parts[n] }))
          .filter((a) => isPositive(a.amount)),
      },
      {
        onSuccess: (p) => {
          toast.success(`Payment recorded · ${p.number}`, {
            description: isPositive(p.unappliedAmount)
              ? `${formatMoney(p.unappliedAmount, p.currency)} kept as ${patient.fullName}’s credit.`
              : `${formatMoney(p.amount, p.currency)} from ${patient.fullName}.`,
            action: { label: 'Receipt', onClick: () => router.push(financeLinks.receipt(p.id)) },
          });
          close();
        },
        onError: (err) => {
          if (!(isApiError(err) && err.errors)) toast.error(err.message);
        },
      },
    );

  const single = chosen.length === 1 ? chosen[0] : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Collect payment</DialogTitle>
          <DialogDescription>
            {patient.fullName} ({patient.code})
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Apply to</legend>
            {invoices.isPending ? (
              <p className="text-[13px] text-muted-foreground">Loading invoices…</p>
            ) : open_.length ? (
              <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-1">
                {open_.map((inv) => {
                  const n = chosen.findIndex((c) => c.id === inv.id);
                  const id = `pay-${inv.id}`;
                  return (
                    <li key={inv.id}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                      >
                        <Checkbox
                          id={id}
                          checked={selected.includes(inv.id)}
                          onCheckedChange={(c) =>
                            setSelected((s) => (c ? [...s, inv.id] : s.filter((x) => x !== inv.id)))
                          }
                        />
                        <span className="grid min-w-0 flex-1">
                          <span className="text-sm font-medium tabular">
                            {inv.number}
                            {inv.overdue && (
                              <span className="ml-2 text-xs font-normal text-danger-foreground">
                                overdue
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {fmt.date(inv.invoiceDate)} · total{' '}
                            {formatMoney(inv.totalAmount, inv.currency)}
                          </span>
                        </span>
                        <span className="grid text-right text-[13px] tabular">
                          <span>{formatMoney(inv.outstanding, inv.currency)} due</span>
                          {n >= 0 && parts[n] && (
                            <span className="text-xs text-success-foreground">
                              paying {formatMoney(parts[n], inv.currency)}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">
                No unpaid invoices.{' '}
                {advanceOff
                  ? 'Advance payments are off, so there’s nothing to collect.'
                  : 'The payment is kept as the patient’s credit, to apply to a later invoice.'}
              </p>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount received" required error={errors.amount}>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular"
                placeholder="0.00"
                autoFocus
              />
            </Field>
            <Field label="Method" required error={errors.methodId}>
              <Select value={methodId} onValueChange={setMethodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {methods.data?.items.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            label="Transaction reference"
            required={method?.requiresReference}
            optional={!method?.requiresReference}
            error={errors.transactionReference}
            helper={
              method?.requiresReference ? `As shown on the ${method.name} confirmation` : undefined
            }
          >
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes" optional error={errors.notes}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <dl className="grid gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5">
            {single ? (
              <>
                <Row label="Invoice total" value={formatMoney(single.totalAmount, currency)} />
                <Row label="Already paid" value={formatMoney(single.paidAmount, currency)} />
                <Row label="Outstanding" value={formatMoney(single.outstanding, currency)} />
              </>
            ) : (
              <Row
                label={`Outstanding on ${chosen.length} invoice${chosen.length === 1 ? '' : 's'}`}
                value={formatMoney(owed, currency)}
              />
            )}
            <Row label="This payment" value={valid ? formatMoney(amount, currency) : '—'} strong />
            <Row
              label="Remaining after payment"
              value={formatMoney(subtractMoney(owed, applied), currency)}
              tone={valid && compareMoney(owed, applied) === 0 ? 'success' : undefined}
            />
            {hasExcess && (
              <Row label="Kept as credit" value={formatMoney(excess, currency)} tone="warning" />
            )}
          </dl>
          {method && method.name.toLowerCase() !== 'cash' && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              This records the payment by hand. It isn’t confirmed with {method.name}: check the
              transaction yourself before recording it.
            </p>
          )}
          {(problem || (isApiError(mutation.error) && !mutation.error.errors)) && (
            <p className="text-sm text-danger-foreground" role="alert">
              {problem ?? mutation.error?.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={mutation.isPending}>
            Record {valid ? formatMoney(amount, currency) : 'payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A trigger and its dialog, for screens that just need a "Collect payment" button. */
export function useCollectPaymentDialog(): [
  (args: { patient: { id: string; fullName: string; code: string }; invoiceId?: string }) => void,
  React.ReactNode,
] {
  const [args, setArgs] = React.useState<{
    patient: { id: string; fullName: string; code: string };
    invoiceId?: string;
  } | null>(null);
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setArgs(null), []);
  const dialog = args ? (
    <CollectPaymentDialog
      key={`${args.patient.id}:${args.invoiceId ?? ''}`}
      patient={args.patient}
      invoiceId={args.invoiceId}
      open
      onClose={() => setArgs(null)}
    />
  ) : null;
  return [setArgs, dialog];
}
