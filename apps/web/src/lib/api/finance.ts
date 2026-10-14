'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';

import type { Expense, ID, Invoice, InvoiceStatus, Payment, PaymentMethod } from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { patientRef, type PatientRef } from './refs';

export type InvoiceWithRefs = Invoice & { patient: PatientRef; balance: number };
export type PaymentWithRefs = Payment & { patient: PatientRef; invoiceNumber?: string };

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank transfer',
};

export async function listInvoices(params: {
  status?: InvoiceStatus | 'all' | 'outstanding';
  patientId?: ID;
  search?: string;
}): Promise<InvoiceWithRefs[]> {
  await latency();
  const db = backend();
  const q = params.search?.trim().toLowerCase();
  return clone(
    db.invoices
      .map((inv) => ({
        ...inv,
        patient: patientRef(db, inv.patientId),
        balance: inv.total - inv.paid,
      }))
      .filter((inv) => {
        if (params.patientId && inv.patientId !== params.patientId) return false;
        if (params.status === 'outstanding' && inv.balance <= 0) return false;
        if (
          params.status &&
          !['all', 'outstanding'].includes(params.status) &&
          inv.status !== params.status
        )
          return false;
        if (
          q &&
          !inv.number.toLowerCase().includes(q) &&
          !inv.patient.fullName.toLowerCase().includes(q) &&
          !inv.patient.code.toLowerCase().includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
  );
}

export async function listPayments(params: {
  from?: string;
  to?: string;
  patientId?: ID;
}): Promise<PaymentWithRefs[]> {
  await latency();
  const db = backend();
  return clone(
    db.payments
      .filter((p) => {
        const at = parseISO(p.receivedAt);
        if (params.from && at < parseISO(params.from)) return false;
        if (params.to && at >= parseISO(params.to)) return false;
        if (params.patientId && p.patientId !== params.patientId) return false;
        return true;
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map((p) => ({
        ...p,
        patient: patientRef(db, p.patientId),
        invoiceNumber: db.invoices.find((i) => i.id === p.invoiceId)?.number,
      })),
  );
}

export interface PaymentInput {
  patientId: ID;
  invoiceId?: ID;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  receivedBy: string;
}

export async function recordPayment(input: PaymentInput): Promise<Payment> {
  await latency(500);
  const db = backend();
  if (input.amount <= 0) throw new Error('Amount must be greater than zero.');
  const invoice = input.invoiceId ? db.invoices.find((i) => i.id === input.invoiceId) : undefined;
  if (invoice) {
    const balance = invoice.total - invoice.paid;
    if (input.amount > balance) {
      throw new Error(
        `Amount is more than the invoice balance of ৳${balance.toLocaleString('en-IN')}.`,
      );
    }
    invoice.paid += input.amount;
    invoice.status = invoice.paid >= invoice.total ? 'paid' : 'partial';
    const pkg = db.patientPackages.find((p) => p.id === invoice.patientPackageId);
    if (pkg) pkg.paidAmount += input.amount;
  }
  const payment: Payment = {
    id: uid('pay'),
    receiptNumber: `RCP-${5001 + db.payments.length}`,
    invoiceId: input.invoiceId,
    patientId: input.patientId,
    amount: input.amount,
    method: input.method,
    reference: input.reference,
    receivedAt: new Date().toISOString(),
    receivedBy: input.receivedBy,
  };
  db.payments.push(payment);
  return clone(payment);
}

export async function listExpenses(): Promise<Expense[]> {
  await latency();
  return clone([...backend().expenses].sort((a, b) => b.date.localeCompare(a.date)));
}

export async function addExpense(input: Omit<Expense, 'id'>): Promise<Expense> {
  await latency(400);
  const expense: Expense = { ...input, id: uid('exp') };
  backend().expenses.push(expense);
  return clone(expense);
}

export interface FinanceSummary {
  collected: number;
  expenses: number;
  net: number;
  outstanding: number;
  overdueCount: number;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  daily: { date: string; amount: number; count: number }[];
}

export async function getFinanceSummary(params: {
  from: string;
  to: string;
}): Promise<FinanceSummary> {
  await latency();
  const db = backend();
  const from = parseISO(params.from);
  const to = parseISO(params.to);
  const payments = db.payments.filter((p) => {
    const at = parseISO(p.receivedAt);
    return at >= from && at < to;
  });
  const expenses = db.expenses.filter((e) => {
    const at = parseISO(e.date);
    return at >= from && at < to;
  });
  const collected = payments.reduce((s, p) => s + p.amount, 0);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const outstandingInvoices = db.invoices.filter((i) => i.status !== 'void' && i.total > i.paid);
  const byMethod = (Object.keys(paymentMethodLabels) as PaymentMethod[]).map((method) => {
    const items = payments.filter((p) => p.method === method);
    return { method, amount: items.reduce((s, p) => s + p.amount, 0), count: items.length };
  });
  const dailyMap = new Map<string, { amount: number; count: number }>();
  for (const p of payments) {
    const d = format(parseISO(p.receivedAt), 'yyyy-MM-dd');
    const row = dailyMap.get(d) ?? { amount: 0, count: 0 };
    row.amount += p.amount;
    row.count += 1;
    dailyMap.set(d, row);
  }
  return {
    collected,
    expenses: spent,
    net: collected - spent,
    outstanding: outstandingInvoices.reduce((s, i) => s + i.total - i.paid, 0),
    overdueCount: outstandingInvoices.filter((i) => i.status === 'overdue').length,
    byMethod,
    daily: [...dailyMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useInvoices(params: Parameters<typeof listInvoices>[0]) {
  return useQuery({
    queryKey: keys.invoices(params),
    queryFn: () => listInvoices(params),
    placeholderData: keepPreviousData,
  });
}

export function usePayments(params: Parameters<typeof listPayments>[0]) {
  return useQuery({
    queryKey: keys.payments(params),
    queryFn: () => listPayments(params),
    placeholderData: keepPreviousData,
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordPayment,
    onSuccess: () => {
      for (const key of [
        'invoices',
        'payments',
        'patient-packages',
        'dashboard',
        'reports',
        'finance',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useExpenses() {
  return useQuery({ queryKey: keys.expenses, queryFn: listExpenses });
}

export function useAddExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.expenses });
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useFinanceSummary(params: { from: string; to: string }) {
  return useQuery({
    queryKey: ['finance', 'summary', params],
    queryFn: () => getFinanceSummary(params),
    placeholderData: keepPreviousData,
  });
}
