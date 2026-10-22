'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardPlus, FileText, X } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { useAppointment, useAppointmentList } from '@/lib/api/appointments';
import {
  useAssessmentPatientOptions,
  useCreateAssessment,
  useTemplateList,
} from '@/lib/api/assessments';
import { isApiError } from '@/lib/api/client';
import { usePatient } from '@/lib/api/patients';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { AssessmentKind } from '@/lib/types';
import { centerToday, useCenterFormat } from '../appointments/appointment-display';
import { PatientAvatar, formatPatientAge } from '../patients/patient-display';
import { ASSESSMENT_KINDS, assessmentLinks } from './assessment-display';

const KIND_HINTS: Record<AssessmentKind, string> = {
  INITIAL: 'First assessment for this service',
  FOLLOW_UP: 'Review progress or a new concern',
  REASSESSMENT: 'Full re-evaluation after a treatment period',
};

interface ChosenPatient {
  id: string;
  code: string;
  fullName: string;
  photoUrl: string | null;
  detail?: string;
}

/**
 * Who, what and when, then the form opens as a draft. Opened from an assessment
 * appointment it's filled in from the booking; from a patient profile, with the patient.
 */
function NewAssessmentForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { activeCenter, can } = useSession();
  const fmt = useCenterFormat();
  const today = centerToday(activeCenter.timezone);

  // ── Prefill from an appointment or a patient profile ──
  const fromAppointment = useAppointment(search.get('appointmentId') ?? undefined);
  const booking = fromAppointment.data;
  const fromPatient = usePatient(
    can('patients.read') ? (search.get('patientId') ?? undefined) : undefined,
  );

  const [picked, setPicked] = React.useState<ChosenPatient | null>(null);
  const [cleared, setCleared] = React.useState(false);
  const prefilled: ChosenPatient | null = booking
    ? { ...booking.patient, detail: booking.patient.code }
    : fromPatient.data
      ? { ...fromPatient.data, detail: fromPatient.data.code }
      : null;
  const patient = picked ?? (cleared ? null : prefilled);
  const [patientQuery, setPatientQuery] = React.useState('');
  const debounced = useDebounced(patientQuery, 250);
  const patients = useAssessmentPatientOptions(debounced, !patient);

  const [kind, setKind] = React.useState<AssessmentKind>(
    (search.get('type') as AssessmentKind) in ASSESSMENT_KINDS
      ? (search.get('type') as AssessmentKind)
      : 'INITIAL',
  );
  const types = useTherapyTypeList({ status: 'ACTIVE' });
  const [therapyChoice, setTherapyChoice] = React.useState(search.get('therapyTypeId') ?? '');
  const therapyTypeId = therapyChoice || booking?.therapyType.id || '';

  const templates = useTemplateList(
    { therapyTypeId, status: ['PUBLISHED'], purpose: kind },
    Boolean(therapyTypeId),
  );
  const [templateChoice, setTemplateChoice] = React.useState('');
  const usable = templates.data ?? [];
  // One template for this therapy: use it without asking.
  const templateId =
    usable.find((t) => t.id === templateChoice)?.id ?? (usable.length === 1 ? usable[0].id : '');

  const therapists = useTherapistList(
    { status: 'ACTIVE', therapyTypeId, pageSize: 100, sortBy: 'fullName' },
    Boolean(therapyTypeId),
  );
  // Assessments are signed by their therapist, so they need a staff account.
  const signers = (therapists.data?.items ?? []).filter((t) => t.hasAccount);
  const [therapistChoice, setTherapistChoice] = React.useState('');
  const therapistId =
    signers.find((t) => t.id === therapistChoice)?.id ??
    signers.find((t) => t.id === booking?.therapist.id)?.id ??
    signers.find((t) => t.isYou)?.id ??
    (signers.length === 1 ? signers[0].id : '');
  const withoutAccount = (therapists.data?.items.length ?? 0) - signers.length;

  const [dateChoice, setDateChoice] = React.useState<string | undefined>();
  const date = dateChoice ?? booking?.date ?? today;

  const appointments = useAppointmentList(
    {
      patientId: patient?.id,
      therapistId,
      therapyTypeId,
      type: 'ASSESSMENT',
      status: ['SCHEDULED', 'CONFIRMED', 'COMPLETED'],
      sortOrder: 'desc',
      pageSize: 20,
    },
    Boolean(patient && therapistId && therapyTypeId),
  );
  const [appointmentChoice, setAppointmentChoice] = React.useState<string | null>(null);
  const appointmentId =
    appointmentChoice === 'none'
      ? ''
      : (appointmentChoice ??
        (booking && booking.patient.id === patient?.id && booking.therapist.id === therapistId
          ? booking.id
          : ''));

  const create = useCreateAssessment();
  const errors = isApiError(create.error) ? (create.error.errors ?? {}) : {};
  const existing = isApiError(create.error)
    ? (create.error.details.assessmentId as string | undefined)
    : undefined;
  const ready = Boolean(patient && therapyTypeId && templateId && therapistId && date);

  const submit = () => {
    if (!ready) return;
    create.mutate(
      {
        patientId: patient!.id,
        therapyTypeId,
        type: kind,
        templateId,
        therapistId,
        assessmentDate: date,
        ...(appointmentId && { appointmentId }),
      },
      {
        onSuccess: (a) => {
          toast.success('Assessment started', {
            description: `${a.patient.fullName} · ${a.template.name}`,
          });
          router.push(assessmentLinks.detail(a.id));
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors)) toast.error(e.message);
        },
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Patient and service</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Patient" required error={errors.patientId} className="sm:col-span-2">
              {patient ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <PatientAvatar patient={patient} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{patient.fullName}</p>
                    <p className="text-[13px] text-muted-foreground">{patient.detail}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Choose another patient"
                    onClick={() => {
                      setPicked(null);
                      setCleared(true);
                      setAppointmentChoice(null);
                    }}
                  >
                    <X />
                  </Button>
                </div>
              ) : (
                <SearchableSelect
                  options={(patients.data?.items ?? []).map((p) => ({
                    value: p.id,
                    label: p.fullName,
                    description: [p.code, formatPatientAge(p.age)].filter(Boolean).join(' · '),
                    leading: <PatientAvatar patient={p} size="sm" />,
                  }))}
                  onChange={(id) => {
                    const p = patients.data?.items.find((x) => x.id === id);
                    if (p) setPicked({ ...p, detail: p.code });
                  }}
                  onSearch={setPatientQuery}
                  loading={patients.isFetching && !patients.data}
                  placeholder="Search by name or patient ID"
                  searchPlaceholder="Name or patient ID…"
                  emptyText={
                    can('patients.read')
                      ? 'No patients found.'
                      : 'No patients found. You can assess patients who have an appointment with you.'
                  }
                />
              )}
            </Field>
            <Field label="Therapy" required error={errors.therapyTypeId}>
              <Select
                value={therapyTypeId}
                onValueChange={(v) => {
                  setTherapyChoice(v);
                  setTemplateChoice('');
                  setTherapistChoice('');
                  setAppointmentChoice(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a therapy" />
                </SelectTrigger>
                <SelectContent>
                  {types.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <ColorDot color={t.color} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date" required error={errors.assessmentDate}>
              <DatePicker value={date} onChange={(v) => setDateChoice(v ?? today)} />
            </Field>
            <div className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">Assessment type</span>
              <RadioGroup
                value={kind}
                onValueChange={(v) => {
                  setKind(v as AssessmentKind);
                  setTemplateChoice('');
                }}
                className="sm:grid-cols-3"
                aria-label="Assessment type"
              >
                {(Object.keys(ASSESSMENT_KINDS) as AssessmentKind[]).map((k) => (
                  <RadioCard
                    key={k}
                    value={k}
                    title={ASSESSMENT_KINDS[k]}
                    description={KIND_HINTS[k]}
                  />
                ))}
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Form and therapist</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Template"
              required
              error={errors.templateId}
              helper={
                therapyTypeId && templates.data && usable.length === 0
                  ? 'No published template for this therapy and type yet.'
                  : undefined
              }
            >
              <Select
                value={templateId}
                onValueChange={setTemplateChoice}
                disabled={!therapyTypeId || usable.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={therapyTypeId ? 'Choose a template' : 'Choose a therapy first'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <FileText className="size-3.5 text-muted-foreground" />
                        {t.name}
                        <span className="text-muted-foreground">v{t.published?.version}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Therapist"
              required
              error={errors.therapistId}
              helper={
                withoutAccount > 0
                  ? `${withoutAccount} therapist${withoutAccount === 1 ? '' : 's'} without a staff account can’t sign assessments.`
                  : undefined
              }
            >
              <Select
                value={therapistId}
                onValueChange={(v) => {
                  setTherapistChoice(v);
                  setAppointmentChoice(null);
                }}
                disabled={!therapyTypeId || signers.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a therapist" />
                </SelectTrigger>
                <SelectContent>
                  {signers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.fullName}
                      {t.isYou && <span className="text-muted-foreground"> (you)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Assessment appointment"
              optional
              error={errors.appointmentId}
              className="sm:col-span-2"
              helper="Link the booking this assessment records. Not needed for direct or historical entry."
            >
              <Select
                value={appointmentId || 'none'}
                onValueChange={setAppointmentChoice}
                disabled={!patient || !therapistId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No appointment</SelectItem>
                  {appointments.data?.items.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {fmt.shortDate(a.date)}, {fmt.clock(a.startTime)} · {a.status.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Start assessment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-[13px] text-muted-foreground">
          <p>
            The form opens as a draft you can save and come back to. It keeps this version of the
            template, even if the template changes later.
          </p>
          {existing && (
            <p className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-foreground">
              This appointment already has an assessment.{' '}
              <Link href={assessmentLinks.detail(existing)} className="font-medium underline">
                Open it
              </Link>
            </p>
          )}
          <Button onClick={submit} disabled={!ready} loading={create.isPending}>
            <ClipboardPlus /> Start assessment
          </Button>
          <Button variant="secondary" asChild>
            <Link href={assessmentLinks.list}>Cancel</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function NewAssessmentScreen() {
  return (
    <RequirePermission permission="assessments.create">
      <div className="animate-in">
        <PageHeader
          back={{ href: assessmentLinks.list, label: 'Assessments' }}
          title="New assessment"
          description="Choose the patient, service and form. Clinical findings are recorded next."
        />
        <NewAssessmentForm />
      </div>
    </RequirePermission>
  );
}
