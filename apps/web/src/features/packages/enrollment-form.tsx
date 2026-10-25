'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { PageSkeleton } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  useCreateEnrollment,
  useEnrollment,
  usePackageList,
  useRenewEnrollment,
  type EnrollmentTermsInput,
} from '@/lib/api/packages';
import { usePatient, usePatientList } from '@/lib/api/patients';
import { usePatientPlans } from '@/lib/api/therapy-plans';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type {
  ISODate,
  PackageActivationPolicy,
  PackageDiscountType,
  PackagePeriodUnit,
  TherapyPackageItem,
} from '@/lib/types';
import { TherapyTypeChip, centerToday, useCenterFormat } from '../appointments/appointment-display';
import { PatientAvatar } from '../patients/patient-display';
import {
  ACTIVATION_POLICIES,
  DISCOUNT_TYPES,
  formatMoney,
  packageLinks,
  previewPrice,
  usageLimitText,
  validityText,
} from './package-display';

interface Chosen {
  id: string;
  code: string;
  fullName: string;
  photoUrl: string | null;
}

/** The last valid day, as the API computes it (packages/rules.ts). */
export function previewEnd(start: ISODate, value: number, unit: PackagePeriodUnit): ISODate {
  const d = parseISO(start);
  if (unit === 'DAY') return format(addDays(d, value - 1), 'yyyy-MM-dd');
  if (unit === 'WEEK') return format(addDays(d, value * 7 - 1), 'yyyy-MM-dd');
  const year = d.getFullYear();
  const month = d.getMonth() + value;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (d.getDate() > lastDay) return format(new Date(year, month, lastDay), 'yyyy-MM-dd');
  return format(addDays(new Date(year, month, d.getDate()), -1), 'yyyy-MM-dd');
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground tabular">{children}</dd>
    </div>
  );
}

function EnrollmentForm({ renewId, onSaved }: { renewId?: string; onSaved: () => void }) {
  const router = useRouter();
  const search = useSearchParams();
  const { activeCenter, can } = useSession();
  const fmt = useCenterFormat();
  const today = centerToday(activeCenter.timezone);
  const mayOverride = can('package_enrollments.override_terms');
  // One key per form: a double submit or a retry records the purchase once.
  const [requestId] = React.useState(() => crypto.randomUUID());

  // ── Renewal source ──
  const source = useEnrollment(renewId);
  const renewing = Boolean(renewId);

  // ── Patient ──
  const prefillId = renewing ? source.data?.patient.id : (search.get('patientId') ?? undefined);
  const prefill = usePatient(renewing ? undefined : prefillId);
  const [picked, setPicked] = React.useState<Chosen | null>(null);
  const [cleared, setCleared] = React.useState(false);
  const patient: Chosen | null =
    picked ??
    (cleared
      ? null
      : renewing
        ? (source.data?.patient ?? null)
        : prefill.data
          ? { ...prefill.data }
          : null);
  const [patientQuery, setPatientQuery] = React.useState('');
  const debounced = useDebounced(patientQuery, 250);
  const patients = usePatientList(
    { search: debounced, pageSize: 8, sortBy: 'fullName', sortOrder: 'asc' },
    !patient && !renewing,
  );

  // ── Package ──
  const packages = usePackageList({ status: 'ACTIVE', pageSize: 100 });
  const [packageId, setPackageId] = React.useState(search.get('packageId') ?? '');
  const sourcePackage = source.data?.catalogPackage;
  const chosenId = packageId || (sourcePackage?.isActive ? sourcePackage.id : '') || '';
  const pkg: TherapyPackageItem | undefined = packages.data?.items.find((p) => p.id === chosenId);

  // ── Therapy plan ──
  const seesPlans = can('therapy_plans.read_own');
  const plans = usePatientPlans(patient?.id ?? '', Boolean(patient && seesPlans));
  const planOptions = (plans.data?.items ?? []).filter(
    (p) =>
      ['DRAFT', 'ACTIVE', 'PAUSED'].includes(p.status) &&
      (!pkg || pkg.therapyTypes.some((t) => t.id === p.therapyType.id)),
  );
  const [therapyPlanId, setTherapyPlanId] = React.useState('');
  const planId = planOptions.some((p) => p.id === therapyPlanId) ? therapyPlanId : '';

  // ── Validity ──
  const sourceEnd = source.data?.endDate;
  const renewStart =
    sourceEnd && sourceEnd >= today ? format(addDays(parseISO(sourceEnd), 1), 'yyyy-MM-dd') : null;
  const [policyChoice, setPolicyChoice] = React.useState<PackageActivationPolicy | null>(null);
  const policy: PackageActivationPolicy =
    policyChoice ?? (renewStart ? 'FIXED_DATE' : (pkg?.activationPolicy ?? 'ENROLLMENT_DATE'));
  const [startChoice, setStartChoice] = React.useState<ISODate | undefined>();
  const startDate =
    policy === 'ENROLLMENT_DATE'
      ? today
      : policy === 'FIXED_DATE'
        ? (startChoice ?? renewStart ?? today)
        : null;
  const computedEnd =
    pkg && startDate ? previewEnd(startDate, pkg.validityValue, pkg.validityUnit) : null;
  const [endChoice, setEndChoice] = React.useState<ISODate | undefined>();
  const endDate = policy === 'FIRST_SESSION' ? null : (endChoice ?? computedEnd);

  // ── Sessions and price ──
  const [sessionText, setSessionText] = React.useState('');
  const sessionCount = sessionText.trim() ? Number(sessionText) : (pkg?.sessionCount ?? 0);
  const [discountType, setDiscountType] = React.useState<PackageDiscountType>('NONE');
  const [discountValue, setDiscountValue] = React.useState('');
  const [agreedPrice, setAgreedPrice] = React.useState('');
  const price = pkg ? previewPrice(pkg.price, discountType, discountValue, agreedPrice) : null;
  const [notes, setNotes] = React.useState('');

  const dirty = Boolean(
    picked || packageId || discountValue || agreedPrice || notes || sessionText || endChoice,
  );
  useUnsavedChanges(dirty);

  // ── Saving ──
  const create = useCreateEnrollment();
  const renew = useRenewEnrollment();
  const mutation = renewing ? renew : create;
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const [confirming, setConfirming] = React.useState(false);
  React.useLayoutEffect(() => () => setConfirming(false), []);

  const sessionsOk = Number.isInteger(sessionCount) && sessionCount >= 1 && sessionCount <= 1000;
  const ready = Boolean(patient && pkg && sessionsOk && price && !price.error);

  const terms: EnrollmentTermsInput = {
    requestId,
    therapyPlanId: planId || null,
    activationPolicy: policy,
    ...(policy === 'FIXED_DATE' && startDate && { startDate }),
    ...(endChoice && endChoice !== computedEnd && { endDate: endChoice }),
    ...(pkg && sessionCount !== pkg.sessionCount && { sessionCount }),
    discountType,
    ...((discountType === 'FIXED' || discountType === 'PERCENTAGE') && {
      discountValue: discountValue.trim().replace(/,/g, ''),
    }),
    ...(discountType === 'PRICE_OVERRIDE' && { agreedPrice: agreedPrice.trim().replace(/,/g, '') }),
    notes: notes.trim() || null,
  };

  const submit = () => {
    if (!ready || !patient || !pkg) return;
    const onSuccess = (saved: { id: string; code: string; patient: { fullName: string } }) => {
      toast.success(renewing ? 'Package renewed' : 'Patient enrolled', {
        description: `${saved.code} · ${saved.patient.fullName}. Payment is recorded separately.`,
      });
      setConfirming(false);
      router.push(packageLinks.enrollment(saved.id));
      onSaved();
    };
    const onError = (e: Error) => {
      setConfirming(false);
      if (!(isApiError(e) && e.errors)) toast.error(e.message);
    };
    if (renewId) {
      renew.mutate({ id: renewId, input: { ...terms, packageId: pkg.id } }, { onSuccess, onError });
    } else {
      create.mutate({ ...terms, patientId: patient.id, packageId: pkg.id }, { onSuccess, onError });
    }
  };

  if (renewing && source.isPending) return <PageSkeleton />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="grid content-start gap-4">
        {/* 1 — Patient */}
        <Card>
          <CardHeader>
            <CardTitle>Patient</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Patient" required error={errors.patientId}>
              {patient ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <PatientAvatar patient={patient} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{patient.fullName}</p>
                    <p className="text-[13px] text-muted-foreground">{patient.code}</p>
                  </div>
                  {!renewing && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Choose another patient"
                      onClick={() => {
                        setPicked(null);
                        setCleared(true);
                        setTherapyPlanId('');
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
                    description: [
                      p.code,
                      p.status === 'INACTIVE' && 'Inactive: reactivate to enroll',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    disabled: p.status === 'INACTIVE',
                    leading: <PatientAvatar patient={p} size="sm" />,
                  }))}
                  onChange={(id) => {
                    const p = patients.data?.items.find((x) => x.id === id);
                    if (p) setPicked(p);
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

        {/* 2 — Package */}
        <Card>
          <CardHeader>
            <CardTitle>Package</CardTitle>
            <CardDescription>Only active packages can be chosen.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {renewing && sourcePackage && !sourcePackage.isActive && !packageId && (
              <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-[13px] text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {sourcePackage.name} is no longer offered. Choose another package to renew with.
              </p>
            )}
            <Field label="Package" required error={errors.packageId}>
              <Select
                value={chosenId}
                onValueChange={(v) => {
                  setPackageId(v);
                  setSessionText('');
                  setEndChoice(undefined);
                  setPolicyChoice(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a package" />
                </SelectTrigger>
                <SelectContent>
                  {packages.data?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.sessionCount} sessions · {formatMoney(p.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {pkg && (
              <dl className="grid gap-3 rounded-lg border border-border p-4 text-[13px] sm:grid-cols-2">
                <div className="grid gap-1 sm:col-span-2">
                  <dt className="text-muted-foreground">Eligible therapies</dt>
                  <dd className="flex flex-wrap gap-x-3 gap-y-1">
                    {pkg.therapyTypes.map((t) => (
                      <TherapyTypeChip key={t.id} therapyType={t} full />
                    ))}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">Sessions</dt>
                  <dd>
                    {pkg.sessionCount}
                    {pkg.therapyTypes.length > 1 && ', shared between them'}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">Valid for</dt>
                  <dd>{validityText(pkg.validityValue, pkg.validityUnit)}</dd>
                </div>
                {pkg.usageLimit && (
                  <div className="grid gap-1">
                    <dt className="text-muted-foreground">Usage limit</dt>
                    <dd>{usageLimitText(pkg.usageLimit)}</dd>
                  </div>
                )}
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">Charged for</dt>
                  <dd>
                    {[
                      'Completed sessions',
                      pkg.chargeNoShow && 'no-shows',
                      pkg.chargeLateCancellation && 'late cancellations',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    {!pkg.coversAssessments && '. Not assessments.'}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* 3 — Therapy plan */}
        {seesPlans && (
          <Card>
            <CardHeader>
              <CardTitle>Therapy plan</CardTitle>
              <CardDescription>
                Optional: the treatment this package is for. Nothing is booked from it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Therapy plan" optional error={errors.therapyPlanId}>
                <Select
                  value={planId || 'none'}
                  onValueChange={(v) => setTherapyPlanId(v === 'none' ? '' : v)}
                  disabled={!patient}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No therapy plan</SelectItem>
                    {planOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} · {p.therapyType.code} · {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>
        )}

        {/* 4 — Validity */}
        <Card>
          <CardHeader>
            <CardTitle>Validity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Validity starts" required className="sm:col-span-2">
              <Select
                value={policy}
                onValueChange={(v) => {
                  setPolicyChoice(v as PackageActivationPolicy);
                  setEndChoice(undefined);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVATION_POLICIES).map(([value, p]) => (
                    <SelectItem key={value} value={value}>
                      {p.label} · {p.description.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {policy === 'FIRST_SESSION' ? (
              <p className="text-[13px] text-muted-foreground sm:col-span-2">
                It stays “not started” until its first session is charged. Its end date is set then.
              </p>
            ) : (
              <>
                <Field label="Start date" required error={errors.startDate}>
                  {policy === 'FIXED_DATE' ? (
                    <DatePicker
                      value={startDate ?? undefined}
                      onChange={(v) => {
                        setStartChoice(v ?? today);
                        setEndChoice(undefined);
                      }}
                    />
                  ) : (
                    <Input value={fmt.date(today)} readOnly />
                  )}
                </Field>
                <Field
                  label="Last valid day"
                  required
                  error={errors.endDate}
                  helper={
                    mayOverride
                      ? endChoice && endChoice !== computedEnd
                        ? 'Set by hand'
                        : 'From the package’s validity; you can change it'
                      : 'From the package’s validity'
                  }
                >
                  <DatePicker
                    value={endDate ?? undefined}
                    onChange={(v) => setEndChoice(v)}
                    disabled={!mayOverride || !pkg}
                    disabledDays={startDate ? [{ before: parseISO(startDate) }] : undefined}
                  />
                </Field>
              </>
            )}
          </CardContent>
        </Card>

        {/* 5 — Price and discount */}
        <Card>
          <CardHeader>
            <CardTitle>Sessions, price and discount</CardTitle>
            {!mayOverride && (
              <CardDescription>
                Enrolled on the package’s own terms. A manager can give discounts or change the
                session count.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Sessions"
              required
              error={errors.sessionCount ?? (!sessionsOk && pkg ? 'Enter 1 to 1000' : undefined)}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                value={sessionText || String(pkg?.sessionCount ?? '')}
                onChange={(e) => setSessionText(e.target.value)}
                disabled={!mayOverride || !pkg}
                className="tabular"
              />
            </Field>
            <Field label="Catalog price">
              <Input value={pkg ? formatMoney(pkg.price) : ''} readOnly className="tabular" />
            </Field>
            <Field label="Discount" error={errors.discountType}>
              <Select
                value={discountType}
                onValueChange={(v) => setDiscountType(v as PackageDiscountType)}
                disabled={!mayOverride || !pkg}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DISCOUNT_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {discountType === 'FIXED' || discountType === 'PERCENTAGE' ? (
              <Field
                label={discountType === 'FIXED' ? 'Amount off (৳)' : 'Percentage off'}
                required
                error={errors.discountValue ?? (discountValue ? price?.error : undefined)}
              >
                <Input
                  inputMode="decimal"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === 'FIXED' ? '1000' : '10'}
                  className="tabular"
                />
              </Field>
            ) : discountType === 'PRICE_OVERRIDE' ? (
              <Field
                label="Agreed price (৳)"
                required
                error={errors.agreedPrice ?? (agreedPrice ? price?.error : undefined)}
              >
                <Input
                  inputMode="decimal"
                  value={agreedPrice}
                  onChange={(e) => setAgreedPrice(e.target.value)}
                  className="tabular"
                />
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field label="Notes" optional error={errors.notes} className="sm:col-span-2">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* 6 — Confirmation */}
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>{renewing ? 'Renewal' : 'Enrollment'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-[13px]">
          <dl className="grid gap-2">
            <SummaryRow label="Patient">{patient?.fullName ?? '—'}</SummaryRow>
            <SummaryRow label="Package">{pkg?.name ?? '—'}</SummaryRow>
            <SummaryRow label="Sessions">{pkg && sessionsOk ? sessionCount : '—'}</SummaryRow>
            <SummaryRow label="Valid">
              {policy === 'FIRST_SESSION'
                ? 'From the first session'
                : startDate && endDate
                  ? `${fmt.date(startDate)} – ${fmt.date(endDate)}`
                  : '—'}
            </SummaryRow>
            {pkg && discountType !== 'NONE' && (
              <SummaryRow label="Catalog price">{formatMoney(pkg.price)}</SummaryRow>
            )}
          </dl>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-muted-foreground">Agreed price</p>
            <p className="text-kpi tracking-tight tabular">
              {price && !price.error ? formatMoney(price.finalPrice) : '—'}
            </p>
          </div>
          <p className="text-muted-foreground">
            This records what was agreed; it doesn’t take payment or book appointments.
          </p>
          <Button
            onClick={() => setConfirming(true)}
            disabled={!ready}
            loading={mutation.isPending}
          >
            <CheckCircle2 /> {renewing ? 'Renew package' : 'Enroll patient'}
          </Button>
          <Button variant="secondary" asChild>
            <Link
              href={
                renewId
                  ? packageLinks.enrollment(renewId)
                  : prefillId
                    ? `/patients/${prefillId}?tab=packages`
                    : packageLinks.enrollments
              }
            >
              Cancel
            </Link>
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={renewing ? 'Renew this package?' : 'Enroll this patient?'}
        description={
          patient && pkg && price && !price.error
            ? `${patient.fullName}: ${pkg.name}, ${sessionCount} session${sessionCount === 1 ? '' : 's'}, ${
                policy === 'FIRST_SESSION'
                  ? 'valid from the first session'
                  : `valid ${fmt.date(startDate!)} to ${fmt.date(endDate!)}`
              }, for ${formatMoney(price.finalPrice)}.`
            : undefined
        }
        confirmLabel={renewing ? 'Renew package' : 'Enroll patient'}
        loading={mutation.isPending}
        onConfirm={submit}
      />
    </div>
  );
}

export function NewEnrollmentScreen() {
  const search = useSearchParams();
  const renewId = search.get('renew') ?? undefined;
  // Visited routes keep their state: start over after saving or with another prefill.
  const [round, setRound] = React.useState(0);
  return (
    <RequirePermission
      permission={renewId ? 'package_enrollments.renew' : 'package_enrollments.create'}
    >
      <div className="animate-in">
        <PageHeader
          back={{ href: packageLinks.enrollments, label: 'Enrollments' }}
          title={renewId ? 'Renew package' : 'Enroll in a package'}
          description={
            renewId
              ? 'A new purchase for the same patient. The earlier enrollment stays as it is; unused sessions don’t carry over.'
              : 'Choose the patient and package, check the dates and price, then confirm.'
          }
        />
        <EnrollmentForm
          key={`${search.toString()}:${round}`}
          renewId={renewId}
          onSaved={() => setRound((r) => r + 1)}
        />
      </div>
    </RequirePermission>
  );
}
