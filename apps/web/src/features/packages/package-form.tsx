'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PackageSearch, Save } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { Field, FormSection } from '@/components/forms/field';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { isApiError } from '@/lib/api/client';
import {
  useCreatePackage,
  usePackage,
  useUpdatePackage,
  type PackageInput,
} from '@/lib/api/packages';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type { PackageActivationPolicy, PackagePeriodUnit, TherapyPackageItem } from '@/lib/types';
import {
  ACTIVATION_POLICIES,
  PERIOD_UNITS,
  formatMoney,
  fromPaisa,
  packageLinks,
  toPaisa,
  validityText,
} from './package-display';

interface FormState {
  name: string;
  code: string;
  description: string;
  therapyTypeIds: string[];
  sessionCount: string;
  defaultDurationMinutes: string;
  price: string;
  validityValue: string;
  validityUnit: PackagePeriodUnit;
  activationPolicy: PackageActivationPolicy;
  limitUsage: boolean;
  usageLimitCount: string;
  usageLimitPeriod: PackagePeriodUnit;
  coversAssessments: boolean;
  chargeNoShow: boolean;
  chargeLateCancellation: boolean;
  isActive: boolean;
  displayOrder: string;
}

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function fromPackage(p?: TherapyPackageItem): FormState {
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    description: p?.description ?? '',
    therapyTypeIds: p?.therapyTypes.map((t) => t.id) ?? [],
    sessionCount: str(p?.sessionCount),
    defaultDurationMinutes: str(p?.defaultDurationMinutes),
    // Whole amounts read better without ".00".
    price: p ? p.price.replace(/\.00$/, '') : '',
    validityValue: str(p?.validityValue ?? 30),
    validityUnit: p?.validityUnit ?? 'DAY',
    activationPolicy: p?.activationPolicy ?? 'ENROLLMENT_DATE',
    limitUsage: Boolean(p?.usageLimit),
    usageLimitCount: str(p?.usageLimit?.count ?? 3),
    usageLimitPeriod: p?.usageLimit?.period ?? 'WEEK',
    coversAssessments: p?.coversAssessments ?? false,
    chargeNoShow: p?.chargeNoShow ?? false,
    chargeLateCancellation: p?.chargeLateCancellation ?? false,
    isActive: p?.isActive ?? true,
    displayOrder: str(p?.displayOrder ?? 0),
  };
}

const int = (v: string) => (v.trim() ? Number(v) : NaN);

/** What the form sends; the API checks it all again. */
function toInput(f: FormState): PackageInput {
  return {
    name: f.name.trim(),
    ...(f.code.trim() && { code: f.code.trim() }),
    description: f.description,
    therapyTypeIds: f.therapyTypeIds,
    sessionCount: int(f.sessionCount),
    defaultDurationMinutes: f.defaultDurationMinutes.trim() ? int(f.defaultDurationMinutes) : null,
    price: f.price.trim().replace(/,/g, ''),
    validityValue: int(f.validityValue),
    validityUnit: f.validityUnit,
    activationPolicy: f.activationPolicy,
    usageLimitCount: f.limitUsage ? int(f.usageLimitCount) : null,
    usageLimitPeriod: f.limitUsage ? f.usageLimitPeriod : null,
    coversAssessments: f.coversAssessments,
    chargeNoShow: f.chargeNoShow,
    chargeLateCancellation: f.chargeLateCancellation,
    displayOrder: int(f.displayOrder) || 0,
  };
}

/** Errors the form can tell before asking the API. */
function localErrors(f: FormState) {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Package name is required';
  if (!f.therapyTypeIds.length) e.therapyTypeIds = 'Choose at least one therapy';
  const sessions = int(f.sessionCount);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 1000)
    e.sessionCount = 'Enter 1 to 1000 sessions';
  if (toPaisa(f.price) === null) e.price = 'Enter a price, e.g. 9000 or 9000.50';
  const validity = int(f.validityValue);
  if (!Number.isInteger(validity) || validity < 1)
    e.validityValue = 'Enter how long it’s valid for';
  if (f.defaultDurationMinutes.trim()) {
    const d = int(f.defaultDurationMinutes);
    if (!Number.isInteger(d) || d < 5 || d > 480)
      e.defaultDurationMinutes = 'Enter 5 to 480 minutes';
  }
  if (f.limitUsage) {
    const c = int(f.usageLimitCount);
    if (!Number.isInteger(c) || c < 1 || c > 100) e.usageLimitCount = 'Enter 1 to 100 sessions';
  }
  return e;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 sm:col-span-2">
      <label htmlFor={id} className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function PackageForm({
  pkg,
  onSaved,
}: {
  pkg?: TherapyPackageItem;
  /** After saving and navigating away; the page uses it to start the form over */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(pkg);
  const initial = React.useMemo(() => fromPackage(pkg), [pkg]);
  const [form, setForm] = React.useState<FormState>(initial);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const [leaving, setLeaving] = React.useState(false);
  React.useLayoutEffect(() => () => setLeaving(false), []);

  const types = useTherapyTypeList({ status: 'all' });
  const kept = new Set(pkg?.therapyTypes.map((t) => t.id));
  // Inactive therapies can't be added, but ones the package already has can stay.
  const offered = (types.data ?? []).filter((t) => t.isActive || kept.has(t.id));

  const create = useCreatePackage();
  const update = useUpdatePackage();
  const mutation = editing ? update : create;
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const apiErrors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const errors = { ...apiErrors, ...local };

  const submit = () => {
    const e = localErrors(form);
    setLocal(e);
    if (Object.keys(e).length) return;
    const input = toInput(form);
    const onError = (err: Error) => {
      if (!(isApiError(err) && err.errors)) toast.error(err.message);
    };
    if (pkg) {
      update.mutate(
        { id: pkg.id, input: { ...input, code: form.code.trim() || undefined } },
        {
          onSuccess: (saved) => {
            toast.success('Package saved', {
              description: pkg.enrollmentCount
                ? 'Existing enrollments keep the terms they were bought on.'
                : undefined,
            });
            router.push(packageLinks.list);
            setForm(fromPackage(saved));
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      { ...input, isActive: form.isActive },
      {
        onSuccess: (saved) => {
          toast.success('Package added', { description: `${saved.code} · ${saved.name}` });
          router.push(packageLinks.list);
          onSaved?.();
        },
        onError,
      },
    );
  };

  const price = toPaisa(form.price);
  const sessions = int(form.sessionCount);
  const perSession =
    price !== null && Number.isInteger(sessions) && sessions > 0
      ? formatMoney(fromPaisa(price / BigInt(sessions)))
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <Card>
        <CardContent className="pt-6">
          <FormSection title="Basic information">
            <Field label="Package name" required error={errors.name} className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={120}
                placeholder="e.g. OT Monthly"
              />
            </Field>
            <Field
              label="Package code"
              optional={!editing}
              required={editing}
              error={errors.code}
              helper={editing ? undefined : 'Left empty, one is generated, e.g. PKG-0004'}
            >
              <Input
                value={form.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                maxLength={30}
                className="uppercase"
              />
            </Field>
            <Field label="Display order" optional error={errors.displayOrder}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.displayOrder}
                onChange={(e) => set({ displayOrder: e.target.value })}
                className="tabular"
              />
            </Field>
            <Field
              label="Description"
              optional
              error={errors.description}
              className="sm:col-span-2"
            >
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
          </FormSection>

          <FormSection
            title="Eligible therapies"
            description="Sessions of any of these use the package. With several, they share one pool of sessions."
          >
            <fieldset className="grid gap-2 sm:col-span-2" aria-describedby="types-error">
              <legend className="sr-only">Eligible therapies</legend>
              {offered.map((t) => {
                const checked = form.therapyTypeIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-subtle/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(on) =>
                        set({
                          therapyTypeIds: on
                            ? [...form.therapyTypeIds, t.id]
                            : form.therapyTypeIds.filter((x) => x !== t.id),
                        })
                      }
                    />
                    <ColorDot color={t.color} />
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className="text-[13px] text-muted-foreground">{t.code}</span>
                    {!t.isActive && (
                      <span className="text-xs text-muted-foreground">(inactive)</span>
                    )}
                  </label>
                );
              })}
              {errors.therapyTypeIds && (
                <p id="types-error" className="text-xs text-danger-foreground">
                  {errors.therapyTypeIds}
                </p>
              )}
            </fieldset>
          </FormSection>

          <FormSection title="Sessions and duration">
            <Field label="Sessions" required error={errors.sessionCount}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                value={form.sessionCount}
                onChange={(e) => set({ sessionCount: e.target.value })}
                className="tabular"
              />
            </Field>
            <Field
              label="Default session length (minutes)"
              optional
              error={errors.defaultDurationMinutes}
              helper="A suggestion; each appointment keeps its own length"
            >
              <Input
                type="number"
                inputMode="numeric"
                min={5}
                max={480}
                step={5}
                value={form.defaultDurationMinutes}
                onChange={(e) => set({ defaultDurationMinutes: e.target.value })}
                className="tabular"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Validity"
            description="Days and weeks count the start day; a month runs to the day before the same date next month."
          >
            <Field label="Valid for" required error={errors.validityValue}>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.validityValue}
                  onChange={(e) => set({ validityValue: e.target.value })}
                  className="w-24 tabular"
                  aria-label="Validity length"
                />
                <Select
                  value={form.validityUnit}
                  onValueChange={(v) => set({ validityUnit: v as PackagePeriodUnit })}
                >
                  <SelectTrigger aria-label="Validity unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIOD_UNITS).map(([value, u]) => (
                      <SelectItem key={value} value={value}>
                        {u.many[0].toUpperCase() + u.many.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field
              label="Validity starts"
              required
              helper="Preselected when enrolling; staff can change it"
            >
              <Select
                value={form.activationPolicy}
                onValueChange={(v) => set({ activationPolicy: v as PackageActivationPolicy })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVATION_POLICIES).map(([value, p]) => (
                    <SelectItem key={value} value={value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormSection>

          <FormSection
            title="Pricing"
            description="The catalog price. Discounts are given per patient when enrolling."
          >
            <Field
              label="Package price (৳)"
              required
              error={errors.price}
              helper={perSession ? `About ${perSession} per session` : undefined}
            >
              <Input
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set({ price: e.target.value })}
                placeholder="9000"
                className="tabular"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Usage policy"
            description="Nothing here books appointments. Sessions are used when appointments are completed."
          >
            <Toggle
              label="Limit sessions per period"
              description="Off: any number of sessions until the package runs out or expires."
              checked={form.limitUsage}
              onChange={(limitUsage) => set({ limitUsage })}
            />
            {form.limitUsage && (
              <Field
                label="At most"
                required
                error={errors.usageLimitCount}
                className="sm:col-span-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={form.usageLimitCount}
                    onChange={(e) => set({ usageLimitCount: e.target.value })}
                    className="w-24 tabular"
                    aria-label="Sessions per period"
                  />
                  <span className="text-sm text-muted-foreground">sessions per</span>
                  <Select
                    value={form.usageLimitPeriod}
                    onValueChange={(v) => set({ usageLimitPeriod: v as PackagePeriodUnit })}
                  >
                    <SelectTrigger className="w-32" aria-label="Period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PERIOD_UNITS).map(([value, u]) => (
                        <SelectItem key={value} value={value}>
                          {u.per}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            )}
            <Toggle
              label="Covers assessments"
              description="Off: only therapy sessions can use it."
              checked={form.coversAssessments}
              onChange={(coversAssessments) => set({ coversAssessments })}
            />
            <Toggle
              label="Charge no-shows"
              description="A missed session uses one up. Off: the session is given back."
              checked={form.chargeNoShow}
              onChange={(chargeNoShow) => set({ chargeNoShow })}
            />
            <Toggle
              label="Charge late cancellations"
              description="Cancelling inside the center’s cancellation cutoff uses one up. Timely cancellations never do."
              checked={form.chargeLateCancellation}
              onChange={(chargeLateCancellation) => set({ chargeLateCancellation })}
            />
            {!editing && (
              <Toggle
                label="Active"
                description="Inactive packages can’t be chosen for new enrollments."
                checked={form.isActive}
                onChange={(isActive) => set({ isActive })}
              />
            )}
          </FormSection>
        </CardContent>
      </Card>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardContent className="grid gap-3 pt-6 text-[13px] text-muted-foreground">
          <p className="text-sm font-medium text-foreground">Summary</p>
          <p>
            {Number.isInteger(sessions) && sessions > 0 ? sessions : '—'} session
            {sessions === 1 ? '' : 's'}, valid{' '}
            {int(form.validityValue) > 0
              ? validityText(int(form.validityValue), form.validityUnit)
              : '—'}
            , for {price !== null ? formatMoney(form.price.replace(/,/g, '')) : '—'}.
          </p>
          {editing && pkg!.enrollmentCount > 0 && (
            <p className="rounded-lg border border-info/20 bg-info-subtle p-3 text-info-foreground">
              {pkg!.enrollmentCount} enrollment{pkg!.enrollmentCount === 1 ? '' : 's'} keep the
              terms and price they were bought on. Changes apply to new enrollments only.
            </p>
          )}
          <Button onClick={submit} loading={mutation.isPending}>
            <Save /> {editing ? 'Save package' : 'Add package'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => (dirty ? setLeaving(true) : router.push(packageLinks.list))}
          >
            Cancel
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Discard your changes?"
        description="What you’ve entered on this page will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => router.push(packageLinks.list)}
      />
    </div>
  );
}

export function NewPackageScreen() {
  // Visited routes keep their state: start a fresh form after each save.
  const [round, setRound] = React.useState(0);
  return (
    <RequirePermission permission="packages.create">
      <div className="animate-in">
        <PageHeader
          back={{ href: packageLinks.list, label: 'Therapy packages' }}
          title="Add package"
          description="What you sell: sessions, how long they’re valid, the price and the rules for using them."
        />
        <PackageForm key={round} onSaved={() => setRound((r) => r + 1)} />
      </div>
    </RequirePermission>
  );
}

function EditPackage() {
  const { id } = useParams<{ id: string }>();
  const query = usePackage(id);
  useBreadcrumbLabel(id, query.data?.name);
  if (query.isPending) return <PageSkeleton />;
  if (query.error) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={PackageSearch}
            title="Package not found"
            description="It may have been deleted, or the link is wrong."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={packageLinks.list}>Back to packages</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }
  const pkg = query.data;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: packageLinks.list, label: 'Therapy packages' }}
        title={`Edit ${pkg.name}`}
        description={`${pkg.code}${pkg.isActive ? '' : ' · inactive'}`}
      />
      <PackageForm key={pkg.updatedAt} pkg={pkg} />
    </div>
  );
}

export function EditPackageScreen() {
  const { can } = useSession();
  return (
    <RequirePermission permission="packages.read">
      {can('packages.update') ? (
        <EditPackage />
      ) : (
        <Card>
          <EmptyState title="You can view packages but not change them." />
        </Card>
      )}
    </RequirePermission>
  );
}
