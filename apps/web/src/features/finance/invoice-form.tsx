'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, FileText, Plus, Trash2, X } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAppointmentList } from '@/lib/api/appointments';
import {
  useBillableCharges,
  useBillableServices,
  useBillingSettings,
  useCreateInvoice,
  useInvoice,
  useIssueInvoice,
  useUpdateInvoice,
  type InvoiceLineInput,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { usePatient, usePatientList } from '@/lib/api/patients';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type {
  BillableCharge,
  BillingDiscountType,
  InvoiceDetail,
  InvoiceItemKind,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import { PatientAvatar } from '../patients/patient-display';
import {
  DISCOUNT_KINDS,
  ITEM_KINDS,
  financeLinks,
  formatMoney,
  fromPaisa,
  previewInvoice,
  useCenterToday,
} from './finance-display';

/** A line as the form edits it; the API recalculates every number on save. */
interface DraftLine {
  key: string;
  kind: InvoiceItemKind;
  description: string;
  /** What it charges for, shown under the description */
  source: string | null;
  serviceId: string | null;
  appointmentId?: string;
  packageEnrollmentId?: string;
  quantity: number;
  unitPrice: string;
  /** The catalog or agreed price, to tell an override from it */
  listPrice: string | null;
  discountType: BillingDiscountType | null;
  discountValue: string;
}

let lineCounter = 0;
const nextKey = () => `line-${++lineCounter}`;

function lineFromCharge(c: BillableCharge, fmt: ReturnType<typeof useCenterFormat>): DraftLine {
  return {
    key: c.key,
    kind: c.kind,
    description: c.description,
    source: c.appointment
      ? `${fmt.date(c.appointment.date)} · ${c.appointment.therapyType.code} · ${c.appointment.therapist.fullName}`
      : 'Package enrollment',
    serviceId: c.service?.id ?? null,
    appointmentId: c.appointmentId ?? undefined,
    packageEnrollmentId: c.packageEnrollmentId ?? undefined,
    quantity: 1,
    unitPrice: c.unitPrice ?? '',
    listPrice: c.unitPrice,
    discountType: null,
    discountValue: '',
  };
}

function lineFromInvoice(i: InvoiceDetail['items'][number]): DraftLine {
  return {
    key: i.appointment?.id ?? i.packageEnrollment?.id ?? i.id,
    kind: i.kind,
    description: i.description,
    source: i.packageEnrollment
      ? `Package enrollment ${i.packageEnrollment.code}`
      : i.appointment
        ? `${i.appointment.date} · ${i.appointment.therapyType.code}`
        : (i.service?.name ?? null),
    serviceId: i.service?.id ?? null,
    appointmentId: i.appointment?.id,
    packageEnrollmentId: i.packageEnrollment?.id,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    listPrice: i.unitPrice,
    discountType: i.discountType,
    discountValue: i.discountValue ?? '',
  };
}

function toInput(l: DraftLine): InvoiceLineInput {
  return {
    kind: l.kind,
    description: l.description.trim() || null,
    serviceId: l.serviceId,
    appointmentId: l.appointmentId,
    packageEnrollmentId: l.packageEnrollmentId,
    quantity: l.quantity,
    unitPrice: l.unitPrice || null,
    discountType: l.discountType,
    discountValue: l.discountType ? l.discountValue : null,
  };
}

/** Uninvoiced packages, assessments and sessions of the patient, to add as lines. */
function ChargesPicker({
  patientId,
  taken,
  onAdd,
}: {
  patientId: string;
  taken: Set<string>;
  onAdd: (charges: BillableCharge[]) => void;
}) {
  const fmt = useCenterFormat();
  const [upcoming, setUpcoming] = React.useState(false);
  const charges = useBillableCharges({ patientId, includeUpcoming: upcoming });
  const items = (charges.data?.items ?? []).filter((c) => !taken.has(c.key));
  const priced = items.filter((c) => c.unitPrice !== null);
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Not yet invoiced</p>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={upcoming} onCheckedChange={setUpcoming} />
          Include booked sessions (advance payment)
        </label>
      </div>
      {charges.isPending ? (
        <p className="text-[13px] text-muted-foreground">Looking for charges…</p>
      ) : items.length ? (
        <>
          <ul className="grid gap-1">
            {items.map((c) => (
              <li
                key={c.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <span className="grid min-w-0">
                  <span className="text-sm">{c.description}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {ITEM_KINDS[c.kind]}
                    {c.appointment && (
                      <>
                        <TherapyTypeChip therapyType={c.appointment.therapyType} />
                        {fmt.date(c.appointment.date)}
                        {c.appointment.status !== 'COMPLETED' && ' · booked'}
                      </>
                    )}
                  </span>
                  {c.problem && (
                    <span className="text-xs text-warning-foreground">{c.problem}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {c.unitPrice && (
                    <span className="text-sm tabular">{formatMoney(c.unitPrice)}</span>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!c.unitPrice}
                    onClick={() => onAdd([c])}
                  >
                    <Plus /> Add
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {priced.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => onAdd(priced)}
            >
              Add all {priced.length}
            </Button>
          )}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Nothing left to invoice: packages, assessments and completed sessions of this patient are
          already on invoices, or paid for by a package.
        </p>
      )}
    </div>
  );
}

function InvoiceFormBody({ existing }: { existing?: InvoiceDetail }) {
  const router = useRouter();
  const search = useSearchParams();
  const { can } = useSession();
  const fmt = useCenterFormat();
  const today = useCenterToday();
  const settings = useBillingSettings();
  const services = useBillableServices({ status: 'ACTIVE' });
  const create = useCreateInvoice();
  const update = useUpdateInvoice();
  const issueDraft = useIssueInvoice();
  const mutation = existing ? update : create;
  const [requestId] = React.useState(() => crypto.randomUUID());

  // Patient
  const prefillId = existing?.patient.id ?? search.get('patientId') ?? undefined;
  const prefill = usePatient(existing ? undefined : prefillId);
  const [patient, setPatient] = React.useState<{
    id: string;
    fullName: string;
    code: string;
    photoUrl: string | null;
  } | null>(existing ? existing.patient : null);
  if (!patient && !existing && prefill.data) setPatient(prefill.data);
  const [patientQuery, setPatientQuery] = React.useState('');
  const debouncedQuery = useDebounced(patientQuery, 250);
  const patients = usePatientList({ search: debouncedQuery, pageSize: 20 }, !patient);

  // Dates
  const [invoiceDate, setInvoiceDate] = React.useState(existing?.invoiceDate ?? today);
  const [dueDate, setDueDate] = React.useState<string | null | undefined>(
    existing ? existing.dueDate : undefined,
  );
  const defaultDue = React.useMemo(() => {
    if (!settings.data) return undefined;
    const d = new Date(`${invoiceDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + settings.data.defaultDueDays);
    return d.toISOString().slice(0, 10);
  }, [invoiceDate, settings.data]);
  const due = dueDate === undefined ? defaultDue : dueDate;

  // Lines
  const [lines, setLines] = React.useState<DraftLine[]>(
    existing ? existing.items.map(lineFromInvoice) : [],
  );
  const charges = useBillableCharges(patient && !existing ? { patientId: patient.id } : null);
  const wanted = search.get('charges')?.split(',').filter(Boolean) ?? [];
  const [prefilled, setPrefilled] = React.useState(false);
  if (!existing && !prefilled && charges.data && patient) {
    setPrefilled(true);
    const picked = charges.data.items.filter((c) => wanted.includes(c.key) && c.unitPrice);
    if (picked.length) setLines(picked.map((c) => lineFromCharge(c, fmt)));
  }
  const taken = new Set(lines.map((l) => l.key));

  const [discountType, setDiscountType] = React.useState<BillingDiscountType | null>(
    existing?.invoiceDiscount?.type ?? null,
  );
  const [discountValue, setDiscountValue] = React.useState(existing?.invoiceDiscount?.value ?? '');
  const [notes, setNotes] = React.useState(existing?.notes ?? '');

  const canPrice = can('invoices.discount');
  const canDiscount = canPrice && Boolean(settings.data?.allowManualDiscount);
  const canAdditional = can('invoices.additional_charge');
  const taxRate = existing?.taxRate ?? settings.data?.taxRate ?? '0.00';
  const currency = existing?.currency ?? settings.data?.currency;
  const preview = previewInvoice(
    lines.map((l) => ({ ...l, discountValue: l.discountType ? l.discountValue : null })),
    { type: discountType, value: discountValue },
    taxRate,
  );

  const appointments = useAppointmentList(
    { patientId: patient?.id, sortOrder: 'desc', pageSize: 30 },
    Boolean(patient) && canAdditional,
  );

  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const lineError = (n: number) =>
    Object.entries(errors).find(([k]) => k === `items.${n}` || k.startsWith(`items.${n}.`))?.[1];

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addService = (id: string) => {
    const s = services.data?.items.find((x) => x.id === id);
    if (!s) return;
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        kind: 'OTHER',
        description: s.name,
        source: s.code,
        serviceId: s.id,
        quantity: 1,
        unitPrice: s.price,
        listPrice: s.price,
        discountType: null,
        discountValue: '',
      },
    ]);
  };
  const addCustom = () =>
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        kind: 'OTHER',
        description: '',
        source: null,
        serviceId: null,
        quantity: 1,
        unitPrice: '',
        listPrice: null,
        discountType: null,
        discountValue: '',
      },
    ]);
  const addAdditional = (appointmentId: string) => {
    const a = appointments.data?.items.find((x) => x.id === appointmentId);
    if (!a) return;
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        kind: 'ADDITIONAL_FEE',
        description: a.status === 'NO_SHOW' ? 'No-show fee' : 'Additional fee',
        source: `${fmt.date(a.date)} · ${a.therapyType.code} · ${a.therapist.fullName}`,
        serviceId: null,
        appointmentId: a.id,
        quantity: 1,
        unitPrice: '',
        listPrice: null,
        discountType: null,
        discountValue: '',
      },
    ]);
  };

  const ready = Boolean(patient) && lines.length > 0 && preview.complete && !preview.discountError;
  const save = (issue: boolean) => {
    if (!patient) return;
    const body = {
      invoiceDate,
      dueDate: due ?? null,
      items: lines.map(toInput),
      discountType,
      discountValue: discountType ? discountValue : null,
      notes: notes.trim() || null,
    };
    const done = (id: string, number: string | null) => {
      toast.success(issue ? `Invoice ${number} issued` : 'Draft saved');
      router.push(financeLinks.invoice(id));
    };
    const failed = (err: Error) => {
      if (!(isApiError(err) && err.errors)) toast.error(err.message);
    };
    if (existing) {
      update.mutate(
        { id: existing.id, input: { ...body, revision: existing.revision } },
        {
          onSuccess: async (saved) => {
            if (!issue) return done(saved.id, saved.number);
            // Issue after saving, so the issued invoice has exactly these lines.
            try {
              const issued = await issueDraft.mutateAsync(saved.id);
              done(issued.id, issued.number);
            } catch (e) {
              toast.error((e as Error).message);
              router.push(financeLinks.invoice(saved.id));
            }
          },
          onError: failed,
        },
      );
    } else {
      create.mutate(
        { ...body, patientId: patient.id, issue, requestId },
        { onSuccess: (saved) => done(saved.id, saved.number), onError: failed },
      );
    }
  };

  const servicesForOther = (services.data?.items ?? []).filter((s) => s.category === 'OTHER');
  const extraServices = (services.data?.items ?? []).filter((s) => s.category !== 'OTHER');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-4">
        {/* 1 — Patient */}
        <Card>
          <CardHeader>
            <CardTitle>Patient</CardTitle>
            <CardDescription>
              Each patient has their own account, even when a guardian pays for several.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Patient" required error={errors.patientId}>
              {patient ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="flex items-center gap-3">
                    <PatientAvatar patient={patient} size="sm" />
                    <span className="grid">
                      <span className="text-sm font-medium">{patient.fullName}</span>
                      <span className="text-xs text-muted-foreground tabular">{patient.code}</span>
                    </span>
                  </span>
                  {!existing && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Choose another patient"
                      onClick={() => {
                        setPatient(null);
                        setLines([]);
                        setPrefilled(true);
                      }}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              ) : (
                <SearchableSelect
                  options={(patients.data?.items ?? []).map((p) => ({
                    value: p.id,
                    label: p.fullName,
                    description: p.code,
                    leading: <PatientAvatar patient={p} size="sm" />,
                  }))}
                  onChange={(id) => {
                    const p = patients.data?.items.find((x) => x.id === id);
                    if (p) setPatient(p);
                  }}
                  onSearch={setPatientQuery}
                  loading={patients.isFetching && !patients.data}
                  placeholder="Search by name, patient ID or mobile"
                  searchPlaceholder="Name, patient ID or guardian mobile…"
                  emptyText="No patients found."
                />
              )}
            </Field>
          </CardContent>
        </Card>

        {/* 2 — Invoice information */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice information</CardTitle>
            <CardDescription>The invoice number is given when it’s issued.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice date" required error={errors.invoiceDate}>
              <DatePicker value={invoiceDate} onChange={(v) => v && setInvoiceDate(v)} />
            </Field>
            <Field
              label="Due date"
              error={errors.dueDate}
              labelAction={
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={due === null}
                    onCheckedChange={(c) => setDueDate(c ? null : undefined)}
                  />
                  No due date
                </label>
              }
              helper={
                dueDate === undefined && settings.data
                  ? `${settings.data.defaultDueDays} days after the invoice date, by default`
                  : undefined
              }
            >
              <DatePicker
                value={due ?? undefined}
                onChange={(v) => setDueDate(v ?? null)}
                disabled={due === null}
                placeholder="No due date"
              />
            </Field>
          </CardContent>
        </Card>

        {/* 3 — Line items */}
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
            <CardDescription>
              Prices come from the service catalog, or the package’s agreed price.
              {!canPrice && ' Managers can change prices and give discounts.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {errors.items && (
              <p className="flex items-center gap-1.5 text-sm text-danger-foreground">
                <AlertCircle className="size-4" aria-hidden /> {errors.items}
              </p>
            )}
            {lines.length > 0 && (
              <ul className="grid gap-2">
                {lines.map((l, n) => {
                  const p = preview.lines[n];
                  const priceLocked =
                    l.kind === 'PACKAGE' ||
                    ((l.kind === 'ASSESSMENT_FEE' ||
                      l.kind === 'SESSION_FEE' ||
                      l.serviceId !== null) &&
                      l.kind !== 'ADDITIONAL_FEE' &&
                      !canPrice);
                  const error = lineError(n);
                  return (
                    <li
                      key={l.key}
                      className={cn(
                        'grid gap-3 rounded-lg border border-border p-3',
                        error && 'border-danger/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid min-w-0 flex-1 gap-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {ITEM_KINDS[l.kind]}
                            {l.source && ` · ${l.source}`}
                          </span>
                          <Input
                            value={l.description}
                            onChange={(e) => setLine(l.key, { description: e.target.value })}
                            placeholder="Describe the charge"
                            aria-label={`Line ${n + 1} description`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove line ${n + 1}`}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        {l.kind === 'OTHER' || l.kind === 'ADDITIONAL_FEE' ? (
                          <Field label="Qty" className="w-20">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={1000}
                              value={l.quantity}
                              onChange={(e) =>
                                setLine(l.key, { quantity: e.target.valueAsNumber || 0 })
                              }
                              className="tabular"
                            />
                          </Field>
                        ) : null}
                        <Field label="Unit price" className="w-36">
                          <Input
                            inputMode="decimal"
                            value={l.unitPrice}
                            disabled={priceLocked}
                            onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                            className="tabular"
                            placeholder="0.00"
                          />
                        </Field>
                        {canDiscount && l.kind !== 'PACKAGE' && (
                          <Field label="Discount" className="w-48">
                            <div className="flex gap-1">
                              <Select
                                value={l.discountType ?? 'none'}
                                onValueChange={(v) =>
                                  setLine(l.key, {
                                    discountType: v === 'none' ? null : (v as BillingDiscountType),
                                  })
                                }
                              >
                                <SelectTrigger className="w-24" aria-label="Discount type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="FIXED">{DISCOUNT_KINDS.FIXED}</SelectItem>
                                  <SelectItem value="PERCENTAGE">%</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                inputMode="decimal"
                                value={l.discountValue}
                                disabled={!l.discountType}
                                onChange={(e) => setLine(l.key, { discountValue: e.target.value })}
                                className="tabular"
                                aria-label="Discount"
                              />
                            </div>
                          </Field>
                        )}
                        <span className="ml-auto grid text-right">
                          <span className="text-xs text-muted-foreground">Line total</span>
                          <span className="text-sm font-semibold tabular">
                            {p ? formatMoney(fromPaisa(p.total), currency) : '—'}
                          </span>
                          {p && p.discount > BigInt(0) && (
                            <span className="text-xs text-success-foreground tabular">
                              −{formatMoney(fromPaisa(p.discount), currency)}
                            </span>
                          )}
                        </span>
                      </div>
                      {(error || p?.error) && (
                        <p className="flex items-center gap-1.5 text-xs text-danger-foreground">
                          <AlertCircle className="size-3.5" aria-hidden /> {error ?? p?.error}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {patient && !existing && (
              <ChargesPicker
                patientId={patient.id}
                taken={taken}
                onAdd={(cs) => setLines((ls) => [...ls, ...cs.map((c) => lineFromCharge(c, fmt))])}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {(servicesForOther.length > 0 || extraServices.length > 0) && (
                <Select value="" onValueChange={addService}>
                  <SelectTrigger size="sm" className="w-56" aria-label="Add a service">
                    <SelectValue placeholder="Add a service…" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...servicesForOther, ...extraServices].map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {formatMoney(s.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="secondary" size="sm" onClick={addCustom}>
                <Plus /> Custom charge
              </Button>
              {canAdditional && patient && (appointments.data?.items.length ?? 0) > 0 && (
                <Select value="" onValueChange={addAdditional}>
                  <SelectTrigger size="sm" className="w-64" aria-label="Add an additional fee">
                    <SelectValue placeholder="Additional fee for an appointment…" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointments.data?.items.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {fmt.date(a.date)} · {a.therapyType.code} ·{' '}
                        {a.status.toLowerCase().replace('_', '-')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 6 — Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <CardDescription>Printed on the invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Notes" optional error={errors.notes}>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* 4, 5 — Discount, tax and summary */}
      <div className="grid content-start gap-4 lg:sticky lg:top-20">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{formatMoney(preview.subtotal, currency)}</dd>
              </div>
              {canDiscount ? (
                <div className="grid gap-1.5">
                  <dt className="text-muted-foreground">Invoice discount</dt>
                  <dd className="flex gap-1">
                    <Select
                      value={discountType ?? 'none'}
                      onValueChange={(v) =>
                        setDiscountType(v === 'none' ? null : (v as BillingDiscountType))
                      }
                    >
                      <SelectTrigger size="sm" className="w-24" aria-label="Invoice discount type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="FIXED">{DISCOUNT_KINDS.FIXED}</SelectItem>
                        <SelectItem value="PERCENTAGE">%</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      value={discountValue}
                      disabled={!discountType}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className="h-8 tabular"
                      aria-label="Invoice discount"
                      aria-invalid={
                        Boolean(errors.discountValue || preview.discountError) || undefined
                      }
                    />
                  </dd>
                  {(errors.discountValue || preview.discountError) && (
                    <p className="text-xs text-danger-foreground">
                      {errors.discountValue ?? preview.discountError}
                    </p>
                  )}
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discounts</dt>
                <dd className="tabular">−{formatMoney(preview.discount, currency)}</dd>
              </div>
              {taxRate !== '0.00' && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {existing?.taxLabel ?? settings.data?.taxLabel} ({taxRate}%)
                  </dt>
                  <dd className="tabular">{formatMoney(preview.tax, currency)}</dd>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(preview.total, currency)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Calculated again by the server when saved.
            </p>
            {isApiError(mutation.error) && !mutation.error.errors && (
              <p className="text-sm text-danger-foreground" role="alert">
                {mutation.error.message}
              </p>
            )}
            <div className="grid gap-2">
              {can('invoices.issue') && (
                <Button onClick={() => save(true)} disabled={!ready} loading={mutation.isPending}>
                  Issue invoice
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => save(false)}
                disabled={!ready || mutation.isPending}
              >
                {existing ? 'Save draft' : 'Save as draft'}
              </Button>
              <Button variant="ghost" asChild>
                <Link href={existing ? financeLinks.invoice(existing.id) : financeLinks.invoices}>
                  Cancel
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function NewInvoiceScreen() {
  const search = useSearchParams();
  return (
    <RequirePermission permission="invoices.create">
      <div className="animate-in">
        <PageHeader
          back={{ href: financeLinks.invoices, label: 'Invoices' }}
          title="New invoice"
          description="Choose the patient, then add what you’re charging for."
        />
        {/* A new form for each prefill; visited routes otherwise keep the last one's state. */}
        <InvoiceFormBody key={search.toString()} />
      </div>
    </RequirePermission>
  );
}

function EditInvoice() {
  const { id } = useParams<{ id: string }>();
  const query = useInvoice(id);
  useBreadcrumbLabel(id, query.data?.number ?? 'Draft');
  if (query.isPending) return <PageSkeleton />;
  if (query.error || !query.data) {
    return (
      <Card>
        {isApiError(query.error, 404) ? (
          <EmptyState icon={FileText} title="Invoice not found" />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }
  const inv = query.data;
  if (inv.status !== 'DRAFT') {
    return (
      <Card>
        <EmptyState
          icon={FileText}
          title={`${inv.number} has been issued`}
          description="Issued invoices can’t be edited. Void and reissue it to correct it."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={financeLinks.invoice(inv.id)}>Back to invoice</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: financeLinks.invoice(inv.id), label: 'Draft invoice' }}
        title="Edit draft invoice"
        description={`${inv.patient.fullName} (${inv.patient.code})`}
      />
      <InvoiceFormBody key={`${inv.id}:${inv.revision}`} existing={inv} />
    </div>
  );
}

export function EditInvoiceScreen() {
  return (
    <RequirePermission permission="invoices.create">
      <EditInvoice />
    </RequirePermission>
  );
}
