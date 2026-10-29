'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ellipsis, Pencil, Plus, Power, PowerOff, Tags } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field, FormSection } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  useBillableServices,
  useBillingSettings,
  useCreateExpenseCategory,
  useCreatePaymentMethod,
  useCreateService,
  useExpenseCategories,
  usePaymentMethods,
  useSetServiceStatus,
  useUpdateBillingSettings,
  useUpdateExpenseCategory,
  useUpdatePaymentMethod,
  useUpdateService,
  type BillingSettingsUpdate,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useSession } from '@/lib/session';
import type {
  BillableServiceCategory,
  BillableServiceItem,
  BillingSettings,
  ExpenseCategoryItem,
  PaymentMethodItem,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip } from '../../appointments/appointment-display';
import { SERVICE_CATEGORIES, formatMoney } from '../../finance/finance-display';
import { SettingsFormFooter, ToggleRow } from '../settings-controls';

const SUB_TABS = [
  { href: '/settings/billing', label: 'Billing preferences' },
  { href: '/settings/billing/services', label: 'Billable services' },
  { href: '/settings/billing/payment-methods', label: 'Payment methods' },
  { href: '/settings/billing/expense-categories', label: 'Expense categories' },
];

/** The billing settings' own pages, as pills under the settings tabs. */
function BillingSettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Billing settings" className="mb-5 flex flex-wrap gap-1.5">
      {SUB_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className={cn(
            'rounded-full border px-3 py-1 text-[13px] font-medium transition-colors focus-ring',
            pathname === t.href
              ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

// ── Preferences ─────────────────────────────────────────────────────────────

type Values = Omit<BillingSettings, 'currency' | 'timezone' | 'updatedAt'>;

const POLICY_COPY = {
  assessmentBillingPolicy: {
    label: 'Assessment fees',
    auto: 'ON_BOOKING',
    autoLabel: 'Invoice when booked',
    help: 'Booking fees can be collected before or after the assessment.',
  },
  sessionBillingPolicy: {
    label: 'Sessions not covered by a package',
    auto: 'ON_COMPLETION',
    autoLabel: 'Invoice when completed',
    help: 'Package-covered sessions are never invoiced again.',
  },
  packageBillingPolicy: {
    label: 'Package enrollments',
    auto: 'ON_ENROLLMENT',
    autoLabel: 'Invoice when enrolled',
    help: 'At the enrollment’s agreed price. Sessions don’t depend on payment.',
  },
} as const;

function Preferences({ settings }: { settings: BillingSettings }) {
  const { can } = useSession();
  const editable = can('billing_settings.manage');
  const initial = React.useMemo<Values>(
    () => ({
      invoicePrefix: settings.invoicePrefix,
      receiptPrefix: settings.receiptPrefix,
      defaultDueDays: settings.defaultDueDays,
      allowPartialPayment: settings.allowPartialPayment,
      allowAdvancePayment: settings.allowAdvancePayment,
      allowManualDiscount: settings.allowManualDiscount,
      taxRate: settings.taxRate,
      taxLabel: settings.taxLabel,
      assessmentBillingPolicy: settings.assessmentBillingPolicy,
      sessionBillingPolicy: settings.sessionBillingPolicy,
      packageBillingPolicy: settings.packageBillingPolicy,
    }),
    [settings],
  );
  const [values, setValues] = React.useState<Values>(initial);
  const mutation = useUpdateBillingSettings();
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const changed = (Object.keys(values) as (keyof Values)[]).filter((k) => values[k] !== initial[k]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: BillingSettingsUpdate = Object.fromEntries(changed.map((k) => [k, values[k]]));
    mutation.mutate(patch, {
      onSuccess: () =>
        toast.success('Billing preferences saved', {
          description: 'They apply to invoices and payments from now on.',
        }),
      onError: (err) => {
        if (!(isApiError(err) && err.errors)) toast.error(err.message);
      },
    });
  };
  return (
    <form onSubmit={submit}>
      <Card>
        <CardContent className="grid gap-8 pt-5">
          <FormSection
            title="Numbering"
            description="Applies to numbers given from now on; existing invoices and receipts keep theirs."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Invoice prefix"
                error={errors.invoicePrefix}
                helper={`Next looks like ${values.invoicePrefix}000123`}
              >
                <Input
                  value={values.invoicePrefix}
                  onChange={(e) => set('invoicePrefix', e.target.value)}
                  disabled={!editable}
                  maxLength={10}
                />
              </Field>
              <Field
                label="Receipt prefix"
                error={errors.receiptPrefix}
                helper={`Next looks like ${values.receiptPrefix}000123`}
              >
                <Input
                  value={values.receiptPrefix}
                  onChange={(e) => set('receiptPrefix', e.target.value)}
                  disabled={!editable}
                  maxLength={10}
                />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Invoices and payments">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Default due period"
                error={errors.defaultDueDays}
                helper="Days after the invoice date; 0 is due on the day."
              >
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={values.defaultDueDays}
                  onChange={(e) => set('defaultDueDays', e.target.valueAsNumber)}
                  disabled={!editable}
                  className="w-28 tabular"
                />
              </Field>
              <Field label="Currency" helper="The center’s own, set on the center profile.">
                <Input value={settings.currency} disabled className="w-28" />
              </Field>
              <ToggleRow
                label="Allow partial payments"
                description="Collect part of an invoice now and the rest later."
                checked={values.allowPartialPayment}
                onCheckedChange={(v) => set('allowPartialPayment', v)}
                disabled={!editable}
              />
              <ToggleRow
                label="Allow advance payments"
                description="Keep money received beyond what’s invoiced as the patient’s credit, to apply later."
                checked={values.allowAdvancePayment}
                onCheckedChange={(v) => set('allowAdvancePayment', v)}
                disabled={!editable}
              />
              <ToggleRow
                label="Allow manual discounts"
                description="Managers can give discounts on invoices and lines. Package discounts are agreed on the enrollment."
                checked={values.allowManualDiscount}
                onCheckedChange={(v) => set('allowManualDiscount', v)}
                disabled={!editable}
              />
            </div>
          </FormSection>
          <FormSection
            title="Tax"
            description="Charged once per invoice on what’s left after discounts. 0 means no tax."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tax rate (%)" error={errors.taxRate}>
                <Input
                  inputMode="decimal"
                  value={values.taxRate}
                  onChange={(e) => set('taxRate', e.target.value)}
                  disabled={!editable}
                  className="w-28 tabular"
                />
              </Field>
              <Field label="Tax name" error={errors.taxLabel}>
                <Input
                  value={values.taxLabel}
                  onChange={(e) => set('taxLabel', e.target.value)}
                  disabled={!editable}
                  className="w-40"
                />
              </Field>
            </div>
          </FormSection>
          <FormSection
            title="When to invoice"
            description="Manual: staff invoice from the patient’s billing tab. Automatic: an issued invoice is created for the event, once. Nothing scheduled is invoiced on its own otherwise."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {(Object.keys(POLICY_COPY) as (keyof typeof POLICY_COPY)[]).map((key) => {
                const copy = POLICY_COPY[key];
                return (
                  <Field key={key} label={copy.label} helper={copy.help} error={errors[key]}>
                    <Select
                      value={values[key]}
                      onValueChange={(v) => set(key, v as never)}
                      disabled={!editable}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL">Manually</SelectItem>
                        <SelectItem value={copy.auto}>{copy.autoLabel}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                );
              })}
            </div>
          </FormSection>
        </CardContent>
        {editable && (
          <SettingsFormFooter
            dirty={changed.length > 0}
            submitting={mutation.isPending}
            onDiscard={() => setValues(initial)}
          />
        )}
      </Card>
    </form>
  );
}

function PreferencesPage() {
  const query = useBillingSettings();
  if (query.isPending) return <PageSkeleton />;
  if (query.error || !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <Preferences key={query.data.updatedAt} settings={query.data} />;
}

export function BillingSettingsScreen() {
  return (
    <RequirePermission permission="billing.read">
      <SectionHeader
        title="Billing"
        description="How invoices are numbered, when they’re created, and what can be paid."
      />
      <BillingSettingsNav />
      <PreferencesPage />
    </RequirePermission>
  );
}

// ── Billable services ───────────────────────────────────────────────────────

function ServiceDialog({
  service,
  onClose,
}: {
  service?: BillableServiceItem;
  onClose: () => void;
}) {
  const types = useTherapyTypeList({ status: 'all' });
  const create = useCreateService();
  const update = useUpdateService();
  const mutation = service ? update : create;
  const [name, setName] = React.useState(service?.name ?? '');
  const [code, setCode] = React.useState(service?.code ?? '');
  const [category, setCategory] = React.useState<BillableServiceCategory>(
    service?.category ?? 'THERAPY_SESSION',
  );
  const [therapyTypeId, setTherapyTypeId] = React.useState(service?.therapyType?.id ?? 'any');
  const [price, setPrice] = React.useState(service?.price ?? '');
  const [duration, setDuration] = React.useState(service?.defaultDurationMinutes?.toString() ?? '');
  const [description, setDescription] = React.useState(service?.description ?? '');
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const submit = () => {
    const input = {
      name: name.trim(),
      code: code.trim(),
      category,
      therapyTypeId: therapyTypeId === 'any' ? null : therapyTypeId,
      price: price.trim(),
      defaultDurationMinutes: duration ? Number(duration) : null,
      description: description.trim() || null,
    };
    const done = {
      onSuccess: () => {
        toast.success(service ? 'Service saved' : 'Service added', {
          description: service ? 'New prices apply to invoice lines from now on.' : undefined,
        });
        onClose();
      },
      onError: (err: Error) => {
        if (!(isApiError(err) && err.errors)) toast.error(err.message);
      },
    };
    if (service) update.mutate({ id: service.id, input }, done);
    else create.mutate(input, done);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : 'Add a billable service'}</DialogTitle>
          <DialogDescription>
            Invoice lines copy the price they’re made with, so changing it never alters issued
            invoices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service name" required error={errors.name} className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Individual OT session"
            />
          </Field>
          <Field
            label="Service code"
            required
            error={errors.code}
            helper="Unique; stored in capitals"
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="OT-SESSION"
            />
          </Field>
          <Field label="Category" required error={errors.category}>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as BillableServiceCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SERVICE_CATEGORIES) as BillableServiceCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {SERVICE_CATEGORIES[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Therapy"
            optional
            error={errors.therapyTypeId}
            helper="Its own price for this therapy; any therapy otherwise"
          >
            <Select value={therapyTypeId} onValueChange={setTherapyTypeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any therapy</SelectItem>
                {types.data
                  ?.filter((t) => t.isActive || t.id === therapyTypeId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Default price" required error={errors.price}>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="tabular"
              placeholder="0.00"
            />
          </Field>
          <Field label="Default duration (minutes)" optional error={errors.defaultDurationMinutes}>
            <Input
              type="number"
              min={5}
              max={480}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Description" optional error={errors.description} className="sm:col-span-2">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {isApiError(mutation.error) && !mutation.error.errors && (
            <p className="text-sm text-danger-foreground sm:col-span-2">{mutation.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || !code.trim() || !price.trim()}
            loading={mutation.isPending}
          >
            {service ? 'Save' : 'Add service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Services() {
  const { can } = useSession();
  const query = useBillableServices({ status: 'all' });
  const status = useSetServiceStatus();
  const [editing, setEditing] = React.useState<BillableServiceItem | 'new' | null>(null);
  React.useLayoutEffect(() => () => setEditing(null), []);
  const manage = can('billing_services.manage');
  const add = manage && (
    <Button size="sm" onClick={() => setEditing('new')}>
      <Plus /> Add service
    </Button>
  );
  const columns: ColumnDef<BillableServiceItem, unknown>[] = [
    {
      id: 'name',
      header: 'Service',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-xs text-muted-foreground tabular">
            {row.original.code}
            {row.original.usageCount > 0 &&
              ` · on ${row.original.usageCount} invoice line${row.original.usageCount === 1 ? '' : 's'}`}
          </span>
        </span>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => SERVICE_CATEGORIES[row.original.category],
    },
    {
      id: 'therapy',
      header: 'Therapy',
      meta: { className: 'hidden md:table-cell' },
      cell: ({ row }) =>
        row.original.therapyType ? (
          <TherapyTypeChip therapyType={row.original.therapyType} />
        ) : (
          <span className="text-[13px] text-muted-foreground">Any</span>
        ),
    },
    {
      id: 'price',
      header: () => <span className="block text-right">Price</span>,
      meta: { className: 'text-right tabular whitespace-nowrap' },
      cell: ({ row }) => formatMoney(row.original.price),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => {
        const s = row.original;
        if (!s.actions.edit) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(s)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  status.mutate(
                    { id: s.id, isActive: !s.isActive },
                    {
                      onSuccess: () =>
                        toast.success(
                          s.isActive
                            ? `${s.name} can’t be used on new invoices`
                            : `${s.name} is active`,
                        ),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                {s.isActive ? (
                  <>
                    <PowerOff /> Deactivate
                  </>
                ) : (
                  <>
                    <Power /> Activate
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
  return (
    <>
      <DataTable
        label="Billable services"
        columns={columns}
        data={query.data?.items}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(s) => s.id}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Assessment and session services price appointments: a therapy’s own service first,
              then one for any therapy. Packages are priced in the package catalog.
            </p>
            {add}
          </div>
        }
        empty={
          <EmptyState
            icon={Tags}
            title="No services yet"
            description="Add what you charge for, e.g. an initial OT assessment or an individual SLT session."
            action={add}
          />
        }
      />
      {editing && (
        <ServiceDialog
          service={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function BillableServicesScreen() {
  return (
    <RequirePermission permission="billing.read">
      <SectionHeader
        title="Billing"
        description="How invoices are numbered, when they’re created, and what can be paid."
      />
      <BillingSettingsNav />
      <Services />
    </RequirePermission>
  );
}

// ── Payment methods and expense categories ──────────────────────────────────

/** A name, a switch or two, and an active flag: payment methods and expense categories. */
function NamedListDialog<T extends { id: string; name: string; isActive: boolean }>({
  title,
  item,
  withReference,
  onSave,
  pending,
  error,
  onClose,
}: {
  title: string;
  item?: T & { requiresReference?: boolean };
  withReference?: boolean;
  onSave: (input: { name: string; isActive: boolean; requiresReference?: boolean }) => void;
  pending: boolean;
  error: unknown;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(item?.name ?? '');
  const [isActive, setActive] = React.useState(item?.isActive ?? true);
  const [requiresReference, setReference] = React.useState(item?.requiresReference ?? false);
  const errors = isApiError(error) ? (error.errors ?? {}) : {};
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field
            label="Name"
            required
            error={errors.name ?? (isApiError(error) && !error.errors ? error.message : undefined)}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {withReference && (
            <ToggleRow
              label="Needs a transaction reference"
              description="Staff must enter the transaction ID, e.g. for bKash or bank transfers."
              checked={requiresReference}
              onCheckedChange={setReference}
            />
          )}
          <ToggleRow
            label="Active"
            description="Inactive ones stay on past records but can’t be chosen."
            checked={isActive}
            onCheckedChange={setActive}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            loading={pending}
            onClick={() =>
              onSave({ name: name.trim(), isActive, ...(withReference && { requiresReference }) })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Methods() {
  const { can } = useSession();
  const query = usePaymentMethods();
  const create = useCreatePaymentMethod();
  const update = useUpdatePaymentMethod();
  const [editing, setEditing] = React.useState<PaymentMethodItem | 'new' | null>(null);
  React.useLayoutEffect(() => () => setEditing(null), []);
  const manage = can('billing_settings.manage');
  const close = () => {
    create.reset();
    update.reset();
    setEditing(null);
  };
  const columns: ColumnDef<PaymentMethodItem, unknown>[] = [
    {
      id: 'name',
      header: 'Method',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'ref',
      header: 'Reference',
      cell: ({ row }) =>
        row.original.requiresReference ? (
          'Required'
        ) : (
          <span className="text-muted-foreground">Optional</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>,
    },
    {
      id: 'edit',
      header: () => <span className="sr-only">Edit</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) =>
        manage && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${row.original.name}`}
            onClick={() => setEditing(row.original)}
          >
            <Pencil />
          </Button>
        ),
    },
  ];
  return (
    <>
      <DataTable
        label="Payment methods"
        columns={columns}
        data={query.data?.items}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(m) => m.id}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Ways money is received and paid out. Records only: Carezino doesn’t connect to bKash,
              Nagad or banks, so staff confirm each transaction themselves.
            </p>
            {manage && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> Add method
              </Button>
            )}
          </div>
        }
      />
      {editing && (
        <NamedListDialog
          title={editing === 'new' ? 'Add a payment method' : `Edit ${editing.name}`}
          item={editing === 'new' ? undefined : editing}
          withReference
          pending={create.isPending || update.isPending}
          error={create.error ?? update.error}
          onClose={close}
          onSave={(input) =>
            editing === 'new'
              ? create.mutate(input, { onSuccess: close })
              : update.mutate({ id: editing.id, input }, { onSuccess: close })
          }
        />
      )}
    </>
  );
}

export function PaymentMethodsScreen() {
  return (
    <RequirePermission permission="billing.read">
      <SectionHeader
        title="Billing"
        description="How invoices are numbered, when they’re created, and what can be paid."
      />
      <BillingSettingsNav />
      <Methods />
    </RequirePermission>
  );
}

function Categories() {
  const { can } = useSession();
  const query = useExpenseCategories();
  const create = useCreateExpenseCategory();
  const update = useUpdateExpenseCategory();
  const [editing, setEditing] = React.useState<ExpenseCategoryItem | 'new' | null>(null);
  React.useLayoutEffect(() => () => setEditing(null), []);
  const manage = can('billing_settings.manage');
  const close = () => {
    create.reset();
    update.reset();
    setEditing(null);
  };
  const columns: ColumnDef<ExpenseCategoryItem, unknown>[] = [
    {
      id: 'name',
      header: 'Category',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>,
    },
    {
      id: 'edit',
      header: () => <span className="sr-only">Edit</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) =>
        manage && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${row.original.name}`}
            onClick={() => setEditing(row.original)}
          >
            <Pencil />
          </Button>
        ),
    },
  ];
  return (
    <>
      <DataTable
        label="Expense categories"
        columns={columns}
        data={query.data?.items}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(c) => c.id}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Groups for expense reports. Deactivate rather than delete: past expenses keep theirs.
            </p>
            {manage && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> Add category
              </Button>
            )}
          </div>
        }
      />
      {editing && (
        <NamedListDialog
          title={editing === 'new' ? 'Add an expense category' : `Edit ${editing.name}`}
          item={editing === 'new' ? undefined : editing}
          pending={create.isPending || update.isPending}
          error={create.error ?? update.error}
          onClose={close}
          onSave={(input) =>
            editing === 'new'
              ? create.mutate(input, { onSuccess: close })
              : update.mutate({ id: editing.id, input }, { onSuccess: close })
          }
        />
      )}
    </>
  );
}

export function ExpenseCategoriesScreen() {
  return (
    <RequirePermission permission="expenses.read">
      <SectionHeader
        title="Billing"
        description="How invoices are numbered, when they’re created, and what can be paid."
      />
      <BillingSettingsNav />
      <Categories />
    </RequirePermission>
  );
}
