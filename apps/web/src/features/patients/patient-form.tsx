'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Settings2 } from 'lucide-react';
import { z } from 'zod';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field, FormSection } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
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
  useCreatePatient,
  useUpdatePatient,
  type CreatePatientInput,
  type UpdatePatientInput,
} from '@/lib/api/patients';
import { useGeneralSettings } from '@/lib/api/settings';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatCenterDate } from '@/lib/format';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type {
  ConsentPurpose,
  ContactType,
  GuardianMatch,
  GuardianRelationship,
  PatientDetail,
  PatientGender,
  ReferralSource,
} from '@/lib/types';
import { anyMobile, optionalEmail, optionalUrl, requiredText } from '@/lib/validation';
import { GuardianMatches, SelectedGuardian } from './guardian-lookup';
import { patientLinks } from './patient-actions';
import {
  CONSENT_PURPOSES,
  CONTACT_TYPES,
  PATIENT_GENDERS,
  REFERRAL_SOURCES,
  RELATIONSHIPS,
} from './patient-display';

const MAX_AGE_YEARS = 150;

const optionalMobile = z
  .string()
  .trim()
  .refine((v) => v === '' || anyMobile.safeParse(v).success, {
    message: 'Enter a mobile number, e.g. 01712-345678, or +44… for numbers abroad',
  });

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\+?\d{6,15}$/.test(v.replace(/[\s\-()]/g, '')), {
    message: 'Enter a valid phone number',
  });

const base = z.object({
  code: z.string().trim().toUpperCase(),
  fullName: requiredText('Full name').max(120),
  ageMode: z.enum(['dob', 'approx']),
  dateOfBirth: z.string(),
  ageYears: z.string().trim(),
  ageMonths: z.string().trim(),
  gender: z.string(),
  primaryConcern: z.string().trim().max(2000),
  therapyTypeIds: z.array(z.string()),
  photoUrl: optionalUrl,
  contactType: z.enum(['GUARDIAN', 'SELF', 'CAREGIVER']),
  guardianId: z.string(),
  contactName: z.string().trim().max(120),
  /** The contact's details on registration; the patient's own when editing */
  mobile: optionalMobile,
  secondaryMobile: optionalMobile,
  email: optionalEmail,
  address: z.string().trim().max(500),
  relationship: z.string(),
  customRelationship: z.string().trim().max(60),
  emergencyPhone: optionalPhone,
  status: z.enum(['NEW', 'ACTIVE']),
  referralSource: z.string(),
  referralOther: z.string().trim().max(100),
  internalNotes: z.string().trim().max(2000),
  consents: z.array(z.string()),
  consentVersion: z.string().trim().max(100),
});

type Values = z.input<typeof base>;
const FIELDS = Object.keys(base.shape) as FieldPath<Values>[];

/** Same rules as the API, which remains the authority. */
function makeSchema(opts: { editing: boolean; manualCode: boolean; selfPrimary: boolean }) {
  return base.superRefine((v, ctx) => {
    const issue = (path: FieldPath<Values>, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (opts.manualCode && !v.code) issue('code', 'Enter a patient ID');
    if (v.code && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(v.code))
      issue('code', 'Use up to 20 letters, numbers or dashes, e.g. P-0042');
    if (v.ageMode === 'approx') {
      if (!/^\d+$/.test(v.ageYears) || Number(v.ageYears) > MAX_AGE_YEARS)
        issue('ageYears', `Enter whole years from 0 to ${MAX_AGE_YEARS}`);
      if (v.ageMonths && (!/^\d+$/.test(v.ageMonths) || Number(v.ageMonths) > 11))
        issue('ageMonths', 'Enter 0 to 11 months');
    }
    if (v.referralSource === 'OTHER' && !v.referralOther)
      issue('referralOther', 'Say who referred the patient');

    if (opts.editing) {
      if (opts.selfPrimary && !v.mobile)
        issue('mobile', 'The patient is their own primary contact, so their mobile is required');
      return;
    }
    const self = v.contactType === 'SELF';
    if (self || !v.guardianId) {
      if (!v.mobile) issue('mobile', 'Mobile number is required');
    }
    if (!self && !v.guardianId && !v.contactName) issue('contactName', 'Contact name is required');
    if (!self && !v.relationship) issue('relationship', 'Choose a relationship');
    if (!self && v.relationship === 'OTHER' && !v.customRelationship)
      issue('customRelationship', 'Describe the relationship');
  });
}

function toValues(p: PatientDetail | undefined, defaultStatus: 'NEW' | 'ACTIVE'): Values {
  const approx = p?.age?.isApproximate ? p.age : null;
  return {
    code: p?.code ?? '',
    fullName: p?.fullName ?? '',
    ageMode: approx ? 'approx' : 'dob',
    dateOfBirth: p?.dateOfBirth ?? '',
    ageYears: approx ? String(approx.years) : '',
    ageMonths: approx && approx.months ? String(approx.months) : '',
    gender: p?.gender ?? '',
    primaryConcern: p?.primaryConcern ?? '',
    therapyTypeIds: p?.therapyInterests.map((t) => t.therapyTypeId) ?? [],
    photoUrl: p?.photoUrl ?? '',
    contactType: 'GUARDIAN',
    guardianId: '',
    contactName: '',
    mobile: p?.mobile ?? '',
    secondaryMobile: p?.secondaryMobile ?? '',
    email: p?.email ?? '',
    address: p?.address ?? '',
    relationship: '',
    customRelationship: '',
    emergencyPhone: p?.emergencyPhone ?? '',
    status: defaultStatus,
    referralSource: p?.referralSource ?? '',
    referralOther: p?.referralOther ?? '',
    internalNotes: p?.internalNotes ?? '',
    consents: [],
    consentVersion: '',
  };
}

/** API error paths → form fields. */
const ERROR_FIELDS: Record<string, FieldPath<Values>> = {
  'contact.fullName': 'contactName',
  'contact.mobile': 'mobile',
  'contact.secondaryMobile': 'secondaryMobile',
  'contact.email': 'email',
  'contact.address': 'address',
  'contact.relationship': 'relationship',
  'contact.customRelationship': 'customRelationship',
  'approximateAge.years': 'ageYears',
  'approximateAge.months': 'ageMonths',
  approximateAge: 'ageYears',
  therapyTypeIds: 'therapyTypeIds',
};

function TherapyPicker({
  value,
  onChange,
  kept,
  error,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Already on the patient: kept selectable even if the therapy type is now inactive */
  kept: string[];
  error?: string;
}) {
  const { can } = useSession();
  const types = useTherapyTypeList();
  const options = (types.data ?? []).filter((t) => t.isActive || kept.includes(t.id));

  if (types.isPending) return <p className="text-sm text-muted-foreground">Loading therapies…</p>;
  if (!options.length) {
    return (
      <EmptyState
        compact
        icon={Settings2}
        className="rounded-lg border border-dashed border-border sm:col-span-2"
        title="No therapy services set up yet"
        description="You can register the patient now and add their therapy interests later."
        action={
          can('therapy_types.create') && (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/settings/therapy-types">Set up therapy types</Link>
            </Button>
          )
        }
      />
    );
  }
  return (
    <fieldset className="grid gap-1.5 sm:col-span-2">
      <legend className="mb-1.5 text-sm font-medium">
        Interested therapy services{' '}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((t) => {
          const checked = value.includes(t.id);
          return (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-accent/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-subtle"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(on) =>
                  onChange(on === true ? [...value, t.id] : value.filter((v) => v !== t.id))
                }
                aria-describedby={error ? 'therapy-error' : undefined}
              />
              <ColorDot color={t.color} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {!t.isActive && <Badge>Inactive</Badge>}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="therapy-error" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          What the family is asking about. Assessment decides the therapy plan.
        </p>
      )}
    </fieldset>
  );
}

function OptionSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Not specified',
  id,
}: {
  value: string;
  onChange: (value: T | '') => void;
  options: Record<T, string>;
  placeholder?: string;
  id?: string;
}) {
  return (
    <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : (v as T))}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {(Object.entries(options) as [T, string][]).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One page for registering a patient, or editing one. Registration takes a single primary
 * contact; more guardians are added from the profile, where editing manages them too.
 */
export function PatientForm({ patient }: { patient?: PatientDetail }) {
  const router = useRouter();
  const { me } = useSession();
  const editing = Boolean(patient);
  const create = useCreatePatient();
  const update = useUpdatePatient();
  const general = useGeneralSettings();
  const manualCode = general.data ? !general.data.autoGeneratePatientCode : false;
  const defaultStatus = general.data?.defaultPatientStatus ?? 'NEW';
  const initial = React.useMemo(() => toValues(patient, defaultStatus), [patient, defaultStatus]);
  const schema = React.useMemo(
    () => makeSchema({ editing, manualCode, selfPrimary: patient?.primaryContactIsSelf ?? false }),
    [editing, manualCode, patient?.primaryContactIsSelf],
  );
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, setError, setValue, reset } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const [
    ageMode,
    contactType,
    contactName,
    relationship,
    referralSource,
    mobile,
    therapyTypeIds,
    consents,
  ] = useWatch({
    control,
    name: [
      'ageMode',
      'contactType',
      'contactName',
      'relationship',
      'referralSource',
      'mobile',
      'therapyTypeIds',
      'consents',
    ],
  });
  const [chosen, setChosen] = React.useState<GuardianMatch | null>(null);
  const self = contactType === 'SELF';

  // The center's default status arrives with the settings; apply it if untouched.
  React.useEffect(() => {
    if (!editing && !formState.dirtyFields.status) setValue('status', defaultStatus);
  }, [defaultStatus, editing, formState.dirtyFields.status, setValue]);

  useUnsavedChanges(isDirty);
  const [leaving, setLeaving] = React.useState(false);
  const cancelHref = patient ? patientLinks.profile(patient.id) : patientLinks.list;

  const chooseGuardian = (g: GuardianMatch | null) => {
    setChosen(g);
    setValue('guardianId', g?.id ?? '', { shouldDirty: true });
    if (g) setValue('mobile', g.mobile, { shouldDirty: true, shouldValidate: true });
  };

  const placeErrors = (error: unknown) => {
    if (!isApiError(error) || !error.errors) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
      return;
    }
    let placed = false;
    for (const [path, message] of Object.entries(error.errors)) {
      if (path === 'contact.guardianId') {
        chooseGuardian(null);
        continue;
      }
      const field = ERROR_FIELDS[path] ?? (path as FieldPath<Values>);
      if (!FIELDS.includes(field)) continue;
      setError(field, { type: 'server', message }, { shouldFocus: !placed });
      placed = true;
    }
    if (!placed) toast.error(error.message);
  };

  const onSubmit = handleSubmit(async (v) => {
    const age =
      v.ageMode === 'approx'
        ? { years: Number(v.ageYears), months: v.ageMonths ? Number(v.ageMonths) : 0 }
        : null;
    const profile = {
      fullName: v.fullName.trim(),
      dateOfBirth: v.ageMode === 'dob' ? v.dateOfBirth || null : null,
      approximateAge: age,
      gender: v.gender as PatientGender | '',
      primaryConcern: v.primaryConcern.trim(),
      therapyTypeIds: v.therapyTypeIds,
      photoUrl: v.photoUrl.trim(),
      emergencyPhone: v.emergencyPhone.trim(),
      referralSource: v.referralSource as ReferralSource | '',
      referralOther: v.referralSource === 'OTHER' ? v.referralOther.trim() : '',
      internalNotes: v.internalNotes.trim(),
    };
    try {
      if (!patient) {
        const input: CreatePatientInput = {
          ...profile,
          // Blank optional fields are simply left out on create.
          dateOfBirth: profile.dateOfBirth ?? undefined,
          approximateAge: age ?? undefined,
          gender: profile.gender || undefined,
          referralSource: profile.referralSource || undefined,
          code: manualCode ? v.code : undefined,
          status: v.status,
          contact: {
            contactType: v.contactType as ContactType,
            ...(v.guardianId && !self
              ? { guardianId: v.guardianId }
              : {
                  fullName: self ? undefined : v.contactName.trim(),
                  mobile: v.mobile.trim(),
                  secondaryMobile: v.secondaryMobile.trim() || undefined,
                  email: v.email.trim() || undefined,
                  address: v.address.trim() || undefined,
                }),
            ...(!self && {
              relationship: v.relationship as GuardianRelationship,
              customRelationship:
                v.relationship === 'OTHER' ? v.customRelationship.trim() : undefined,
            }),
          },
          consents: v.consents.map((purpose) => ({
            purpose: purpose as ConsentPurpose,
            version: v.consentVersion.trim() || undefined,
          })),
        };
        const created = await create.mutateAsync(input);
        toast.success(`${created.fullName} registered as ${created.code}`);
        reset(v);
        router.push(`${patientLinks.profile(created.id)}?registered=1`);
        return;
      }

      // Only what changed, so an unchanged field never overwrites someone else's edit.
      const before = initial;
      const changed: UpdatePatientInput = {};
      const text = [
        'fullName',
        'gender',
        'primaryConcern',
        'photoUrl',
        'mobile',
        'secondaryMobile',
        'email',
        'address',
        'emergencyPhone',
        'referralSource',
        'internalNotes',
      ] as const;
      for (const key of text) {
        if (v[key].trim() !== before[key].trim()) Object.assign(changed, { [key]: v[key].trim() });
      }
      if (v.referralOther.trim() !== before.referralOther.trim() || changed.referralSource)
        changed.referralOther = profile.referralOther;
      if (manualCode && v.code !== before.code) changed.code = v.code;
      if (
        JSON.stringify([...v.therapyTypeIds].sort()) !==
        JSON.stringify([...before.therapyTypeIds].sort())
      )
        changed.therapyTypeIds = v.therapyTypeIds;
      // A date of birth and an approximate age replace each other on the API.
      if (v.ageMode === 'dob') {
        if (v.dateOfBirth !== before.dateOfBirth) changed.dateOfBirth = v.dateOfBirth || null;
        // A new date of birth replaces the approximate age; no date means no age at all.
        if (before.ageMode === 'approx' && !v.dateOfBirth) changed.approximateAge = null;
      }
      if (
        v.ageMode === 'approx' &&
        (before.ageMode !== 'approx' ||
          v.ageYears !== before.ageYears ||
          (v.ageMonths || '0') !== (before.ageMonths || '0'))
      )
        changed.approximateAge = age;
      if (Object.keys(changed).length) {
        await update.mutateAsync({ id: patient.id, input: changed });
      }
      toast.success('Patient saved');
      reset(v);
      router.push(patientLinks.profile(patient.id));
    } catch (error) {
      placeErrors(error);
    }
  });

  const consentBy = self
    ? 'the patient'
    : chosen?.fullName || contactName.trim() || 'the contact above';

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="pt-6">
          <FormSection
            title="Patient information"
            description={
              patient
                ? `Patient ID ${patient.code}.`
                : manualCode
                  ? 'Your center types its own patient IDs.'
                  : 'A patient ID is assigned automatically when you save.'
            }
          >
            {manualCode && (
              <Field
                label="Patient ID"
                required
                error={errors.code?.message}
                helper={editing ? 'Correct it here if it was typed wrongly.' : undefined}
              >
                <Input className="uppercase" autoComplete="off" {...register('code')} />
              </Field>
            )}
            <Field
              label="Full name"
              required
              error={errors.fullName?.message}
              className={manualCode ? undefined : 'sm:col-span-2'}
            >
              <Input autoComplete="off" placeholder="e.g. Ayaan Rahman" {...register('fullName')} />
            </Field>
            <Controller
              control={control}
              name="ageMode"
              render={({ field }) => (
                <div className="grid gap-1.5 sm:col-span-2">
                  <span className="text-sm font-medium" id="age-mode-label">
                    Age <span className="font-normal text-muted-foreground">(optional)</span>
                  </span>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    aria-labelledby="age-mode-label"
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <RadioCard value="dob" title="Date of birth" />
                    <RadioCard
                      value="approx"
                      title="Approximate age"
                      description="When the date of birth isn’t known"
                    />
                  </RadioGroup>
                </div>
              )}
            />
            {ageMode === 'dob' ? (
              <Controller
                control={control}
                name="dateOfBirth"
                render={({ field }) => (
                  <Field label="Date of birth" optional error={errors.dateOfBirth?.message}>
                    <DatePicker
                      value={field.value || undefined}
                      onChange={(v) => field.onChange(v ?? '')}
                      disabledDays={{ after: new Date() }}
                      withYearSelect
                    />
                  </Field>
                )}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Years" required error={errors.ageYears?.message}>
                  <Input inputMode="numeric" placeholder="e.g. 4" {...register('ageYears')} />
                </Field>
                <Field label="Months" optional error={errors.ageMonths?.message}>
                  <Input inputMode="numeric" placeholder="0–11" {...register('ageMonths')} />
                </Field>
              </div>
            )}
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <Field label="Gender" optional error={errors.gender?.message}>
                  <OptionSelect
                    value={field.value}
                    onChange={field.onChange}
                    options={PATIENT_GENDERS}
                  />
                </Field>
              )}
            />
            <Field
              label="Primary concern"
              optional
              error={errors.primaryConcern?.message}
              className="sm:col-span-2"
              helper="In the family’s words. Assessments are recorded separately."
            >
              <Textarea
                rows={2}
                placeholder="e.g. Not speaking in sentences yet"
                {...register('primaryConcern')}
              />
            </Field>
            <TherapyPicker
              value={therapyTypeIds}
              onChange={(ids) =>
                setValue('therapyTypeIds', ids, { shouldDirty: true, shouldValidate: true })
              }
              kept={initial.therapyTypeIds}
              error={errors.therapyTypeIds?.message}
            />
            <Field
              label="Patient photo"
              optional
              error={errors.photoUrl?.message}
              helper="Link to an image."
              className="sm:col-span-2"
            >
              <Input inputMode="url" placeholder="https://…" {...register('photoUrl')} />
            </Field>
          </FormSection>

          {editing ? (
            <FormSection
              title="Patient’s own contact details"
              description={
                patient?.primaryContactIsSelf
                  ? 'The patient is their own primary contact.'
                  : 'Optional, e.g. for older patients. Guardians are managed on the profile.'
              }
            >
              <Field
                label="Mobile"
                required={patient?.primaryContactIsSelf}
                optional={!patient?.primaryContactIsSelf}
                error={errors.mobile?.message}
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="01712-345678"
                  {...register('mobile')}
                />
              </Field>
              <Field label="Secondary mobile" optional error={errors.secondaryMobile?.message}>
                <Input type="tel" inputMode="tel" {...register('secondaryMobile')} />
              </Field>
              <Field label="Email" optional error={errors.email?.message}>
                <Input type="email" placeholder="name@example.com" {...register('email')} />
              </Field>
              <Field label="Emergency phone" optional error={errors.emergencyPhone?.message}>
                <Input type="tel" inputMode="tel" {...register('emergencyPhone')} />
              </Field>
              <Field
                label="Address"
                optional
                error={errors.address?.message}
                className="sm:col-span-2"
              >
                <Textarea rows={2} {...register('address')} />
              </Field>
            </FormSection>
          ) : (
            <FormSection
              title="Primary contact"
              description="Who the center calls first. You can add more guardians from the patient’s profile."
            >
              <Controller
                control={control}
                name="contactType"
                render={({ field }) => (
                  <div className="grid gap-1.5 sm:col-span-2">
                    <span className="text-sm font-medium" id="contact-type-label">
                      Contact type
                      <span className="text-danger" aria-hidden>
                        *
                      </span>
                    </span>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        if (v === 'SELF') chooseGuardian(null);
                      }}
                      aria-labelledby="contact-type-label"
                      className="grid gap-2 sm:grid-cols-3"
                    >
                      {(['GUARDIAN', 'SELF', 'CAREGIVER'] as const).map((type) => (
                        <RadioCard
                          key={type}
                          value={type}
                          title={CONTACT_TYPES[type].label}
                          description={CONTACT_TYPES[type].description}
                        />
                      ))}
                    </RadioGroup>
                  </div>
                )}
              />
              {chosen && !self ? (
                <SelectedGuardian
                  guardian={chosen}
                  onClear={() => chooseGuardian(null)}
                  className="sm:col-span-2"
                />
              ) : (
                <>
                  <Field
                    label={self ? 'Patient’s mobile' : 'Primary mobile'}
                    required
                    error={errors.mobile?.message}
                    helper="Numbers abroad: start with + and the country code."
                  >
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="01712-345678"
                      {...register('mobile')}
                    />
                  </Field>
                  {!self && (
                    <Field label="Contact name" required error={errors.contactName?.message}>
                      <Input
                        autoComplete="off"
                        placeholder="e.g. Nasrin Akter"
                        {...register('contactName')}
                      />
                    </Field>
                  )}
                  {!self && (
                    <GuardianMatches
                      mobile={mobile}
                      onSelect={chooseGuardian}
                      className="sm:col-span-2"
                    />
                  )}
                </>
              )}
              {!self && (
                <Controller
                  control={control}
                  name="relationship"
                  render={({ field }) => (
                    <Field
                      label="Relationship to patient"
                      required
                      error={errors.relationship?.message}
                    >
                      <OptionSelect
                        value={field.value}
                        onChange={field.onChange}
                        options={RELATIONSHIPS}
                        placeholder="Choose…"
                      />
                    </Field>
                  )}
                />
              )}
              {!self && relationship === 'OTHER' && (
                <Field
                  label="Relationship"
                  required
                  error={errors.customRelationship?.message}
                  helper="e.g. Uncle, Aunt, Nanny"
                >
                  <Input {...register('customRelationship')} />
                </Field>
              )}
              {(self || !chosen) && (
                <>
                  <Field label="Secondary mobile" optional error={errors.secondaryMobile?.message}>
                    <Input type="tel" inputMode="tel" {...register('secondaryMobile')} />
                  </Field>
                  <Field label="Email" optional error={errors.email?.message}>
                    <Input type="email" placeholder="name@example.com" {...register('email')} />
                  </Field>
                  <Field
                    label="Address"
                    optional
                    error={errors.address?.message}
                    className="sm:col-span-2"
                  >
                    <Textarea rows={2} {...register('address')} />
                  </Field>
                </>
              )}
              <Field
                label="Emergency phone"
                optional
                error={errors.emergencyPhone?.message}
                helper="If someone else should be called in an emergency."
              >
                <Input type="tel" inputMode="tel" {...register('emergencyPhone')} />
              </Field>
            </FormSection>
          )}

          <FormSection title="Registration details">
            {!editing && (
              <dl className="grid gap-1 text-sm sm:col-span-2 sm:grid-cols-2">
                <div>
                  <dt className="text-[13px] text-muted-foreground">Registration date</dt>
                  <dd>
                    {formatCenterDate(format(new Date(), 'yyyy-MM-dd'), general.data?.dateFormat)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted-foreground">Registered by</dt>
                  <dd>{me.user.fullName}</dd>
                </div>
              </dl>
            )}
            {!editing && (
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Field label="Patient status" error={errors.status?.message}>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NEW">New</SelectItem>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            )}
            <Controller
              control={control}
              name="referralSource"
              render={({ field }) => (
                <Field label="Referral source" optional error={errors.referralSource?.message}>
                  <OptionSelect
                    value={field.value}
                    onChange={field.onChange}
                    options={REFERRAL_SOURCES}
                  />
                </Field>
              )}
            />
            {referralSource === 'OTHER' && (
              <Field label="Referred by" required error={errors.referralOther?.message}>
                <Input placeholder="e.g. Community health worker" {...register('referralOther')} />
              </Field>
            )}
            <Field
              label="Internal notes"
              optional
              error={errors.internalNotes?.message}
              className="sm:col-span-2"
              helper="Only for center staff."
            >
              <Textarea rows={2} {...register('internalNotes')} />
            </Field>
            {!editing && (
              <fieldset className="grid gap-2 sm:col-span-2">
                <legend className="mb-1 text-sm font-medium">
                  Consent <span className="font-normal text-muted-foreground">(when given)</span>
                </legend>
                {(Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]).map((purpose) => (
                  <label key={purpose} className="flex items-start gap-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={consents.includes(purpose)}
                      onCheckedChange={(on) =>
                        setValue(
                          'consents',
                          on === true
                            ? [...consents, purpose]
                            : consents.filter((c) => c !== purpose),
                          { shouldDirty: true },
                        )
                      }
                    />
                    <span className="grid gap-0.5">
                      <span>{CONSENT_PURPOSES[purpose].label}</span>
                      <span className="text-xs text-muted-foreground">
                        {CONSENT_PURPOSES[purpose].description}
                      </span>
                    </span>
                  </label>
                ))}
                {consents.length > 0 && (
                  <Field
                    label="Consent form or version"
                    optional
                    error={errors.consentVersion?.message}
                    helper={`Recorded as given by ${consentBy}, today, by you. Keep the signed form: this record alone may not meet every legal requirement.`}
                  >
                    <Input
                      placeholder="e.g. Registration form v2"
                      {...register('consentVersion')}
                    />
                  </Field>
                )}
              </fieldset>
            )}
          </FormSection>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => (isDirty ? setLeaving(true) : router.push(cancelHref))}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={editing && !isDirty}>
            {editing ? 'Save changes' : 'Save patient'}
          </Button>
        </CardFooter>
      </form>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Discard your changes?"
        description="What you’ve entered on this page will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => router.push(cancelHref)}
      />
    </Card>
  );
}
