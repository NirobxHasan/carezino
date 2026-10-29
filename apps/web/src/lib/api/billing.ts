'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AgingBucket,
  BillableCharge,
  BillableServiceCategory,
  BillableServiceItem,
  BillingDiscountType,
  BillingSettings,
  CollectionsReport,
  DuesPage,
  ExpenseCategoryItem,
  ExpenseDetail,
  ExpenseItem,
  ExpensesSummary,
  FinanceSummary,
  ISODate,
  InvoiceDetail,
  InvoiceItemKind,
  InvoicePrint,
  InvoiceStatus,
  InvoiceSummary,
  Money,
  PackageSalesReport,
  Paginated,
  PatientBillingSummary,
  PaymentDetail,
  PaymentMethodItem,
  PaymentRefund,
  PaymentStatus,
  PaymentSummary,
  CenterLetterhead,
} from '../types';
import { request } from './client';
import { keys } from './keys';

type ConfigStatus = 'ACTIVE' | 'INACTIVE' | 'all';

function query(params: object) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) q.set(key, value.join(','));
    } else {
      q.set(key, String(value));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const path = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

// ── Inputs ──────────────────────────────────────────────────────────────────

export type BillingSettingsUpdate = Partial<
  Omit<BillingSettings, 'currency' | 'timezone' | 'updatedAt'>
>;

export interface ServiceInput {
  name: string;
  code: string;
  category: BillableServiceCategory;
  therapyTypeId?: string | null;
  price: Money;
  defaultDurationMinutes?: number | null;
  description?: string | null;
  isActive?: boolean;
  displayOrder?: number;
}

/** A line as sent: what it charges for; prices default to the catalog or enrollment. */
export interface InvoiceLineInput {
  kind: InvoiceItemKind;
  description?: string | null;
  serviceId?: string | null;
  appointmentId?: string;
  packageEnrollmentId?: string;
  quantity?: number;
  unitPrice?: Money | null;
  discountType?: BillingDiscountType | null;
  discountValue?: Money | null;
}

export interface InvoiceInput {
  patientId: string;
  invoiceDate?: ISODate;
  /** Left out: the center's due period. Null: no due date */
  dueDate?: ISODate | null;
  items: InvoiceLineInput[];
  discountType?: BillingDiscountType | null;
  discountValue?: Money | null;
  notes?: string | null;
  issue?: boolean;
  requestId?: string;
}

export type InvoiceUpdate = Partial<Omit<InvoiceInput, 'patientId' | 'issue' | 'requestId'>> & {
  revision?: number;
};

export interface InvoiceListParams {
  search?: string;
  patientId?: string;
  status?: InvoiceStatus[];
  overdue?: boolean;
  from?: ISODate;
  to?: ISODate;
  sortBy?: 'invoiceDate' | 'dueDate' | 'createdAt' | 'total';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AllocationInput {
  invoiceId: string;
  amount: Money;
}

export interface CollectInput {
  patientId: string;
  amount: Money;
  methodId: string;
  transactionReference?: string | null;
  collectedAt?: string;
  notes?: string | null;
  allocations?: AllocationInput[];
  /** The same submission sent twice records one payment */
  requestId: string;
}

export interface RefundInput {
  amount: Money;
  methodId: string;
  reason: string;
  reference?: string | null;
  refundedAt?: string;
  requestId: string;
}

export interface PaymentListParams {
  search?: string;
  patientId?: string;
  methodId?: string;
  collectedById?: string;
  status?: PaymentStatus;
  withCredit?: boolean;
  from?: ISODate;
  to?: ISODate;
  page?: number;
  pageSize?: number;
}

export interface ExpenseInput {
  categoryId: string;
  expenseDate: ISODate;
  description: string;
  amount: Money;
  methodId: string;
  reference?: string | null;
  notes?: string | null;
  requestId?: string;
}

export interface ExpenseListParams {
  search?: string;
  categoryId?: string;
  methodId?: string;
  status?: 'RECORDED' | 'VOID';
  from?: ISODate;
  to?: ISODate;
  page?: number;
  pageSize?: number;
}

export interface RangeParams {
  from?: ISODate;
  to?: ISODate;
}

export interface DuesParams {
  search?: string;
  patientId?: string;
  therapyTypeId?: string;
  overdue?: boolean;
  aging?: AgingBucket;
  from?: ISODate;
  to?: ISODate;
  page?: number;
  pageSize?: number;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export const billingApi = {
  settings: () => request<BillingSettings>('/billing/settings'),
  updateSettings: (input: BillingSettingsUpdate) =>
    request<BillingSettings>('/billing/settings', { method: 'PATCH', body: input }),
  methods: (status: ConfigStatus = 'all') =>
    request<{ items: PaymentMethodItem[] }>(`/billing/payment-methods${query({ status })}`),
  createMethod: (input: Partial<PaymentMethodItem>) =>
    request<PaymentMethodItem>('/billing/payment-methods', { method: 'POST', body: input }),
  updateMethod: (id: string, input: Partial<PaymentMethodItem>) =>
    request<PaymentMethodItem>(path('/billing/payment-methods', id), {
      method: 'PATCH',
      body: input,
    }),
  categories: (status: ConfigStatus = 'all') =>
    request<{ items: ExpenseCategoryItem[] }>(`/billing/expense-categories${query({ status })}`),
  createCategory: (input: Partial<ExpenseCategoryItem>) =>
    request<ExpenseCategoryItem>('/billing/expense-categories', { method: 'POST', body: input }),
  updateCategory: (id: string, input: Partial<ExpenseCategoryItem>) =>
    request<ExpenseCategoryItem>(path('/billing/expense-categories', id), {
      method: 'PATCH',
      body: input,
    }),
  services: (params: { status?: ConfigStatus; category?: BillableServiceCategory } = {}) =>
    request<{ items: BillableServiceItem[] }>(`/billing/services${query(params)}`),
  createService: (input: ServiceInput) =>
    request<BillableServiceItem>('/billing/services', { method: 'POST', body: input }),
  updateService: (id: string, input: Partial<ServiceInput>) =>
    request<BillableServiceItem>(path('/billing/services', id), { method: 'PATCH', body: input }),
  setServiceStatus: (id: string, isActive: boolean) =>
    request<BillableServiceItem>(`${path('/billing/services', id)}/status`, {
      method: 'PATCH',
      body: { isActive },
    }),
  charges: (params: { patientId: string; includeUpcoming?: boolean }) =>
    request<{ items: BillableCharge[] }>(`/billing/charges${query(params)}`),
};

export const invoicesApi = {
  list: (params: InvoiceListParams) =>
    request<Paginated<InvoiceSummary>>(
      `/invoices${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<InvoiceDetail>(path('/invoices', id)),
  print: (id: string) => request<InvoicePrint>(`${path('/invoices', id)}/print`),
  create: (input: InvoiceInput) =>
    request<InvoiceDetail>('/invoices', { method: 'POST', body: input }),
  update: (id: string, input: InvoiceUpdate) =>
    request<InvoiceDetail>(path('/invoices', id), { method: 'PATCH', body: input }),
  discard: (id: string) => request<void>(path('/invoices', id), { method: 'DELETE' }),
  issue: (id: string) =>
    request<InvoiceDetail>(`${path('/invoices', id)}/issue`, { method: 'POST' }),
  void: (id: string, input: { reason: string; reissue?: boolean }) =>
    request<{ invoice: InvoiceDetail; reissueId: string | null }>(`${path('/invoices', id)}/void`, {
      method: 'POST',
      body: input,
    }),
  applyCredit: (id: string, input: { amount: Money; requestId: string }) =>
    request<InvoiceDetail>(`${path('/invoices', id)}/apply-credit`, {
      method: 'POST',
      body: input,
    }),
  patientInvoices: (patientId: string) =>
    request<{ items: InvoiceSummary[] }>(`${path('/patients', patientId)}/invoices`),
  patientSummary: (patientId: string) =>
    request<PatientBillingSummary>(`${path('/patients', patientId)}/billing-summary`),
};

export const paymentsApi = {
  list: (params: PaymentListParams) =>
    request<Paginated<PaymentSummary> & { totals: { amount: Money; refunded: Money } }>(
      `/payments${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<PaymentDetail>(path('/payments', id)),
  receipt: (id: string) =>
    request<{ center: CenterLetterhead; payment: PaymentDetail }>(
      `${path('/payments', id)}/receipt`,
    ),
  collect: (input: CollectInput) =>
    request<PaymentDetail>('/payments', { method: 'POST', body: input }),
  allocate: (id: string, input: { allocations: AllocationInput[]; requestId: string }) =>
    request<PaymentDetail>(`${path('/payments', id)}/allocations`, {
      method: 'POST',
      body: input,
    }),
  release: (id: string, allocationId: string, reason: string) =>
    request<PaymentDetail>(
      `${path('/payments', id)}/allocations/${encodeURIComponent(allocationId)}/release`,
      { method: 'POST', body: { reason } },
    ),
  refund: (id: string, input: RefundInput) =>
    request<PaymentDetail>(`${path('/payments', id)}/refund`, { method: 'POST', body: input }),
  reverse: (id: string, reason: string) =>
    request<PaymentDetail>(`${path('/payments', id)}/reverse`, {
      method: 'POST',
      body: { reason },
    }),
  patientPayments: (patientId: string) =>
    request<{
      items: PaymentSummary[];
      refunds: (PaymentRefund & { payment: { id: string; number: string } })[];
    }>(`${path('/patients', patientId)}/payments`),
};

export const expensesApi = {
  list: (params: ExpenseListParams) =>
    request<Paginated<ExpenseItem> & { totalAmount: Money }>(
      `/expenses${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<ExpenseDetail>(path('/expenses', id)),
  create: (input: ExpenseInput) =>
    request<ExpenseDetail>('/expenses', { method: 'POST', body: input }),
  correct: (id: string, input: Partial<ExpenseInput> & { reason: string; revision?: number }) =>
    request<ExpenseDetail>(path('/expenses', id), { method: 'PATCH', body: input }),
  void: (id: string, reason: string) =>
    request<ExpenseDetail>(`${path('/expenses', id)}/void`, { method: 'POST', body: { reason } }),
};

export const financeApi = {
  summary: (params: RangeParams) => request<FinanceSummary>(`/finance/summary${query(params)}`),
  dues: (params: DuesParams) =>
    request<DuesPage>(
      `/finance/dues${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  collections: (params: RangeParams & { collectedById?: string }) =>
    request<CollectionsReport>(`/finance/collections${query(params)}`),
  expenses: (params: RangeParams) =>
    request<ExpensesSummary>(`/finance/expenses-summary${query(params)}`),
  packageSales: (params: RangeParams) =>
    request<PackageSalesReport>(`/finance/package-sales${query(params)}`),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useBillingSettings(enabled = true) {
  return useQuery({ queryKey: keys.billingSettings, queryFn: billingApi.settings, enabled });
}

export function usePaymentMethods(status: ConfigStatus = 'all', enabled = true) {
  return useQuery({
    queryKey: keys.paymentMethods({ status }),
    queryFn: () => billingApi.methods(status),
    enabled,
  });
}

export function useExpenseCategories(status: ConfigStatus = 'all', enabled = true) {
  return useQuery({
    queryKey: keys.expenseCategories({ status }),
    queryFn: () => billingApi.categories(status),
    enabled,
  });
}

export function useBillableServices(
  params: { status?: ConfigStatus; category?: BillableServiceCategory } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: keys.billableServices(params),
    queryFn: () => billingApi.services(params),
    enabled,
  });
}

export function useBillableCharges(
  params: { patientId: string; includeUpcoming?: boolean } | null,
) {
  return useQuery({
    queryKey: keys.billableCharges(params ?? {}),
    queryFn: () => billingApi.charges(params!),
    enabled: Boolean(params?.patientId),
  });
}

export function useInvoiceList(params: InvoiceListParams, enabled = true) {
  return useQuery({
    queryKey: keys.invoiceList(params),
    queryFn: () => invoicesApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: keys.invoice(id ?? ''),
    queryFn: () => invoicesApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useInvoicePrint(id: string | undefined) {
  return useQuery({
    queryKey: keys.invoicePrint(id ?? ''),
    queryFn: () => invoicesApi.print(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function usePatientInvoices(patientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.patientInvoices(patientId ?? ''),
    queryFn: () => invoicesApi.patientInvoices(patientId!),
    enabled: enabled && Boolean(patientId),
  });
}

export function usePatientBilling(patientId: string, enabled = true) {
  return useQuery({
    queryKey: keys.patientBilling(patientId),
    queryFn: () => invoicesApi.patientSummary(patientId),
    enabled,
  });
}

export function usePaymentList(params: PaymentListParams, enabled = true) {
  return useQuery({
    queryKey: keys.paymentList(params),
    queryFn: () => paymentsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: keys.payment(id ?? ''),
    queryFn: () => paymentsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useReceipt(id: string | undefined) {
  return useQuery({
    queryKey: keys.receipt(id ?? ''),
    queryFn: () => paymentsApi.receipt(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function usePatientPayments(patientId: string, enabled = true) {
  return useQuery({
    queryKey: keys.patientPayments(patientId),
    queryFn: () => paymentsApi.patientPayments(patientId),
    enabled,
  });
}

export function useExpenseList(params: ExpenseListParams, enabled = true) {
  return useQuery({
    queryKey: keys.expenseList(params),
    queryFn: () => expensesApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: keys.expense(id ?? ''),
    queryFn: () => expensesApi.get(id!),
    enabled: Boolean(id),
  });
}

export function useFinanceSummary(params: RangeParams, enabled = true) {
  return useQuery({
    queryKey: keys.financeSummary(params),
    queryFn: () => financeApi.summary(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDues(params: DuesParams, enabled = true) {
  return useQuery({
    queryKey: keys.dues(params),
    queryFn: () => financeApi.dues(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCollectionsReport(
  params: RangeParams & { collectedById?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: keys.collections(params),
    queryFn: () => financeApi.collections(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useExpensesSummary(params: RangeParams, enabled = true) {
  return useQuery({
    queryKey: keys.expensesSummary(params),
    queryFn: () => financeApi.expenses(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePackageSales(params: RangeParams, enabled = true) {
  return useQuery({
    queryKey: keys.packageSales(params),
    queryFn: () => financeApi.packageSales(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Any change to invoices or payments moves balances shown across finance screens,
 * the patient's billing tab and the reports, so they all refresh.
 */
function useMoneyMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['invoices', 'payments', 'finance']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

function useConfigMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['invoices', 'charges'] });
    },
  });
}

export const useUpdateBillingSettings = () => useConfigMutation(billingApi.updateSettings);
export const useCreatePaymentMethod = () => useConfigMutation(billingApi.createMethod);
export const useUpdatePaymentMethod = () =>
  useConfigMutation((v: { id: string; input: Partial<PaymentMethodItem> }) =>
    billingApi.updateMethod(v.id, v.input),
  );
export const useCreateExpenseCategory = () => useConfigMutation(billingApi.createCategory);
export const useUpdateExpenseCategory = () =>
  useConfigMutation((v: { id: string; input: Partial<ExpenseCategoryItem> }) =>
    billingApi.updateCategory(v.id, v.input),
  );
export const useCreateService = () => useConfigMutation(billingApi.createService);
export const useUpdateService = () =>
  useConfigMutation((v: { id: string; input: Partial<ServiceInput> }) =>
    billingApi.updateService(v.id, v.input),
  );
export const useSetServiceStatus = () =>
  useConfigMutation((v: { id: string; isActive: boolean }) =>
    billingApi.setServiceStatus(v.id, v.isActive),
  );

export const useCreateInvoice = () => useMoneyMutation(invoicesApi.create);
export const useUpdateInvoice = () =>
  useMoneyMutation((v: { id: string; input: InvoiceUpdate }) => invoicesApi.update(v.id, v.input));
export const useDiscardInvoice = () => useMoneyMutation(invoicesApi.discard);
export const useIssueInvoice = () => useMoneyMutation(invoicesApi.issue);
export const useVoidInvoice = () =>
  useMoneyMutation((v: { id: string; reason: string; reissue?: boolean }) =>
    invoicesApi.void(v.id, { reason: v.reason, reissue: v.reissue }),
  );
export const useApplyCredit = () =>
  useMoneyMutation((v: { id: string; amount: Money; requestId: string }) =>
    invoicesApi.applyCredit(v.id, { amount: v.amount, requestId: v.requestId }),
  );
export const useCollectPayment = () => useMoneyMutation(paymentsApi.collect);
export const useAllocatePayment = () =>
  useMoneyMutation((v: { id: string; allocations: AllocationInput[]; requestId: string }) =>
    paymentsApi.allocate(v.id, { allocations: v.allocations, requestId: v.requestId }),
  );
export const useReleaseAllocation = () =>
  useMoneyMutation((v: { id: string; allocationId: string; reason: string }) =>
    paymentsApi.release(v.id, v.allocationId, v.reason),
  );
export const useRefundPayment = () =>
  useMoneyMutation((v: { id: string; input: RefundInput }) => paymentsApi.refund(v.id, v.input));
export const useReversePayment = () =>
  useMoneyMutation((v: { id: string; reason: string }) => paymentsApi.reverse(v.id, v.reason));

function useExpenseMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export const useCreateExpense = () => useExpenseMutation(expensesApi.create);
export const useCorrectExpense = () =>
  useExpenseMutation(
    (v: { id: string; input: Partial<ExpenseInput> & { reason: string; revision?: number } }) =>
      expensesApi.correct(v.id, v.input),
  );
export const useVoidExpense = () =>
  useExpenseMutation((v: { id: string; reason: string }) => expensesApi.void(v.id, v.reason));
