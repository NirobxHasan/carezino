'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { ID, Invoice, PatientPackage, PaymentStatus, TherapyPackage } from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { patientRef, type PatientRef } from './refs';

export async function listPackages(): Promise<(TherapyPackage & { activeEnrolments: number })[]> {
  await latency();
  const db = backend();
  return clone(
    db.packages.map((p) => ({
      ...p,
      activeEnrolments: db.patientPackages.filter(
        (pp) => pp.packageId === p.id && pp.status === 'active',
      ).length,
    })),
  );
}

export type PackageInput = Omit<TherapyPackage, 'id'> & { id?: ID };

export async function savePackage(input: PackageInput): Promise<TherapyPackage> {
  await latency(400);
  const db = backend();
  if (input.id) {
    const existing = db.packages.find((p) => p.id === input.id);
    if (!existing) throw new Error('Package not found');
    Object.assign(existing, input);
    return clone(existing);
  }
  const created: TherapyPackage = { ...input, id: uid('pkg') };
  db.packages.push(created);
  return clone(created);
}

export type PatientPackageView = PatientPackage & {
  patient: PatientRef;
  remainingSessions: number;
  paymentStatus: PaymentStatus;
  daysToExpiry: number;
};

function toView(db: ReturnType<typeof backend>, pp: PatientPackage): PatientPackageView {
  const remaining = Math.max(0, pp.totalSessions - pp.usedSessions);
  return {
    ...pp,
    patient: patientRef(db, pp.patientId),
    remainingSessions: remaining,
    paymentStatus: pp.paidAmount >= pp.price ? 'paid' : pp.paidAmount > 0 ? 'partial' : 'unpaid',
    daysToExpiry: differenceInCalendarDays(parseISO(pp.expiresAt), new Date()),
  };
}

export async function listPatientPackages(params: {
  patientId?: ID;
  status?: PatientPackage['status'] | 'all';
  therapyTypeId?: ID;
}): Promise<PatientPackageView[]> {
  await latency();
  const db = backend();
  return clone(
    db.patientPackages
      .filter(
        (pp) =>
          (!params.patientId || pp.patientId === params.patientId) &&
          (!params.therapyTypeId || pp.therapyTypeId === params.therapyTypeId) &&
          (!params.status || params.status === 'all' || pp.status === params.status),
      )
      .map((pp) => toView(db, pp))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
  );
}

export async function assignPackage(input: {
  patientId: ID;
  packageId: ID;
  startDate: string;
  discount: number;
}): Promise<{ patientPackage: PatientPackage; invoice: Invoice }> {
  await latency(500);
  const db = backend();
  const tpl = db.packages.find((p) => p.id === input.packageId);
  if (!tpl) throw new Error('Package not found');
  const start = parseISO(input.startDate);
  const price = Math.max(0, tpl.price - input.discount);
  const patientPackage: PatientPackage = {
    id: uid('pp'),
    patientId: input.patientId,
    packageId: tpl.id,
    name: tpl.name,
    therapyTypeId: tpl.therapyTypeId,
    totalSessions: tpl.sessionCount,
    usedSessions: 0,
    scheduledSessions: 0,
    startDate: input.startDate,
    expiresAt: format(addDays(start, tpl.validityDays), 'yyyy-MM-dd'),
    price,
    paidAmount: 0,
    status: 'active',
  };
  db.patientPackages.push(patientPackage);
  const invoice: Invoice = {
    id: uid('inv'),
    number: `INV-${format(new Date(), 'yyMM')}-${String(db.invoices.length + 101).padStart(4, '0')}`,
    patientId: input.patientId,
    patientPackageId: patientPackage.id,
    issuedAt: format(new Date(), 'yyyy-MM-dd'),
    dueAt: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    items: [{ description: tpl.name, quantity: 1, unitPrice: tpl.price }],
    discount: input.discount,
    total: price,
    paid: 0,
    status: price === 0 ? 'paid' : 'unpaid',
  };
  db.invoices.push(invoice);
  return clone({ patientPackage, invoice });
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function usePackages() {
  return useQuery({ queryKey: keys.packages, queryFn: listPackages });
}

export function useSavePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savePackage,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.packages }),
  });
}

export function usePatientPackages(params: Parameters<typeof listPatientPackages>[0]) {
  return useQuery({
    queryKey: keys.patientPackages(params),
    queryFn: () => listPatientPackages(params),
  });
}

export function useAssignPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assignPackage,
    onSuccess: () => {
      for (const key of ['patient-packages', 'invoices', 'packages', 'dashboard']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
