import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  FileCheck2,
  FilePen,
  UserX,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import type {
  AppointmentStatus,
  AssessmentStatus,
  PrototypeInvoiceStatus,
  NoteStatus,
  PatientPackageStatus,
  PatientStatus,
  PrototypePaymentStatus,
  TherapistStatus,
} from '@/lib/types';

interface StatusDef {
  label: string;
  tone: BadgeTone;
  icon?: LucideIcon;
}

/** Status with a label and icon: colour is never the only signal. */
export function StatusBadge({ def, className }: { def: StatusDef; className?: string }) {
  const Icon = def.icon;
  return (
    <Badge tone={def.tone} className={className}>
      {Icon ? (
        <Icon aria-hidden />
      ) : (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {def.label}
    </Badge>
  );
}

export const appointmentStatus: Record<AppointmentStatus, StatusDef> = {
  scheduled: { label: 'Scheduled', tone: 'info', icon: CalendarClock },
  checked_in: { label: 'Checked in', tone: 'primary', icon: CircleDot },
  completed: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  no_show: { label: 'No-show', tone: 'danger', icon: UserX },
};

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  return <StatusBadge def={appointmentStatus[status]} className={className} />;
}

const patientStatus: Record<PatientStatus, StatusDef> = {
  active: { label: 'Active', tone: 'success' },
  waitlist: { label: 'Waitlist', tone: 'warning' },
  on_hold: { label: 'On hold', tone: 'neutral' },
  discharged: { label: 'Discharged', tone: 'outline' },
};

export const patientStatusLabels = Object.fromEntries(
  Object.entries(patientStatus).map(([k, v]) => [k, v.label]),
) as Record<PatientStatus, string>;

export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  return <StatusBadge def={patientStatus[status]} />;
}

const therapistStatus: Record<TherapistStatus | 'off_today', StatusDef> = {
  active: { label: 'Active', tone: 'success' },
  on_leave: { label: 'On leave', tone: 'warning' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  off_today: { label: 'Off today', tone: 'neutral' },
};

export function TherapistStatusBadge({ status }: { status: TherapistStatus | 'off_today' }) {
  return <StatusBadge def={therapistStatus[status]} />;
}

const invoiceStatus: Record<PrototypeInvoiceStatus, StatusDef> = {
  paid: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  partial: { label: 'Partly paid', tone: 'warning', icon: CircleDashed },
  unpaid: { label: 'Unpaid', tone: 'info', icon: Clock },
  overdue: { label: 'Overdue', tone: 'danger', icon: Clock },
  void: { label: 'Void', tone: 'neutral', icon: Ban },
};

export function InvoiceStatusBadge({ status }: { status: PrototypeInvoiceStatus }) {
  return <StatusBadge def={invoiceStatus[status]} />;
}

const paymentStatus: Record<PrototypePaymentStatus, StatusDef> = {
  paid: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  partial: { label: 'Partly paid', tone: 'warning', icon: CircleDashed },
  unpaid: { label: 'Unpaid', tone: 'danger', icon: Clock },
};

export function PaymentStatusBadge({ status }: { status: PrototypePaymentStatus }) {
  return <StatusBadge def={paymentStatus[status]} />;
}

const packageStatus: Record<PatientPackageStatus, StatusDef> = {
  active: { label: 'Active', tone: 'success' },
  completed: { label: 'Completed', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function PackageStatusBadge({ status }: { status: PatientPackageStatus }) {
  return <StatusBadge def={packageStatus[status]} />;
}

const noteStatus: Record<NoteStatus, StatusDef> = {
  none: { label: 'Note pending', tone: 'warning', icon: FilePen },
  draft: { label: 'Draft', tone: 'warning', icon: FilePen },
  submitted: { label: 'Submitted', tone: 'success', icon: FileCheck2 },
};

export function NoteStatusBadge({ status }: { status: NoteStatus }) {
  return <StatusBadge def={noteStatus[status]} />;
}

const assessmentStatus: Record<AssessmentStatus, StatusDef> = {
  scheduled: { label: 'Scheduled', tone: 'info', icon: CalendarClock },
  draft: { label: 'Draft', tone: 'warning', icon: FilePen },
  completed: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
};

export function AssessmentStatusBadge({ status }: { status: AssessmentStatus }) {
  return <StatusBadge def={assessmentStatus[status]} />;
}
