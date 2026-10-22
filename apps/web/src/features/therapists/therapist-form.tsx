'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Settings2 } from 'lucide-react';
import { z } from 'zod';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field, FormSection } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { useGeneralSettings, useWorkingHours } from '@/lib/api/settings';
import { useStaff } from '@/lib/api/staff';
import {
  useCreateTherapist,
  useSetSpecializations,
  useUpdateTherapist,
  type TherapistInput,
} from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import type { EmploymentType, PersonGender, TherapistDetail } from '@/lib/types';
import { anyMobile, optionalEmail, optionalUrl, requiredText } from '@/lib/validation';
import {
  AvailabilityEditor,
  emptyWeek,
  toAvailabilityInput,
  validateWeek,
  type DayValue,
} from './availability-editor';
import { EMPLOYMENT_TYPES, GENDERS } from './therapist-display';
import { therapistLinks } from './therapist-actions';

const MAX_YEARS = 70;

/** Same rules as the API; it remains the authority. */
const schema = z
  .object({
    fullName: requiredText('Full name').max(120),
    mobile: anyMobile,
    email: optionalEmail,
    gender: z.string(),
    photoUrl: optionalUrl,
    designation: z.string().trim().max(100),
    qualifications: z.string().trim().max(1000),
    registrationNumber: z.string().trim().max(60),
    yearsOfExperience: z
      .string()
      .trim()
      .refine((v) => !v.startsWith('-'), 'Experience can’t be negative')
      .refine(
        (v) => v === '' || v.startsWith('-') || (/^\d+$/.test(v) && Number(v) <= MAX_YEARS),
        `Enter whole years from 0 to ${MAX_YEARS}`,
      ),
    joiningDate: z.string(),
    employmentType: z.string(),
    notes: z.string().trim().max(2000),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    therapyTypeIds: z.array(z.string()),
    primaryTherapyTypeId: z.string(),
    membershipId: z.string(),
  })
  .refine((v) => !v.therapyTypeIds.length || v.therapyTypeIds.includes(v.primaryTherapyTypeId), {
    path: ['primaryTherapyTypeId'],
    message: 'Choose which specialization is primary',
  });

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape) as FieldPath<Values>[];

function toValues(t?: TherapistDetail): Values {
  const primary = t?.specializations.find((s) => s.isPrimary);
  return {
    fullName: t?.fullName ?? '',
    mobile: t?.mobile ?? '',
    email: t?.email ?? '',
    gender: t?.gender ?? '',
    photoUrl: t?.photoUrl ?? '',
    designation: t?.designation ?? '',
    qualifications: t?.qualifications ?? '',
    registrationNumber: t?.registrationNumber ?? '',
    yearsOfExperience: t?.yearsOfExperience?.toString() ?? '',
    joiningDate: t?.joiningDate ?? '',
    employmentType: t?.employmentType ?? '',
    notes: t?.notes ?? '',
    status: t?.status ?? 'ACTIVE',
    therapyTypeIds: t?.specializations.map((s) => s.therapyTypeId) ?? [],
    primaryTherapyTypeId: primary?.therapyTypeId ?? '',
    membershipId: t?.account?.membershipId ?? '',
  };
}

/** Form values → API input. Blank optional fields are sent empty, which clears them. */
function toInput(v: Values): TherapistInput {
  return {
    fullName: v.fullName.trim(),
    mobile: v.mobile.trim(),
    email: v.email.trim(),
    gender: v.gender as PersonGender | '',
    photoUrl: v.photoUrl.trim(),
    designation: v.designation.trim(),
    qualifications: v.qualifications.trim(),
    registrationNumber: v.registrationNumber.trim(),
    yearsOfExperience: v.yearsOfExperience.trim() === '' ? null : Number(v.yearsOfExperience),
    joiningDate: v.joiningDate || null,
    employmentType: v.employmentType as EmploymentType | '',
    notes: v.notes.trim(),
    membershipId: v.membershipId || null,
  };
}

function SpecializationPicker({
  value,
  primary,
  onChange,
  assigned,
  error,
}: {
  value: string[];
  primary: string;
  onChange: (ids: string[], primary: string) => void;
  /** Already on the profile: kept selectable even if the therapy type is now inactive */
  assigned: string[];
  error?: string;
}) {
  const { can } = useSession();
  const types = useTherapyTypeList();
  const options = (types.data ?? []).filter((t) => t.isActive || assigned.includes(t.id));

  if (types.isPending)
    return <p className="text-sm text-muted-foreground">Loading therapy types…</p>;
  if (!options.length) {
    return (
      <EmptyState
        compact
        icon={Settings2}
        className="sm:col-span-2 rounded-lg border border-dashed border-border"
        title="No therapy types yet"
        description="Therapists are matched to bookings by the therapy types your center offers."
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

  const toggle = (id: string, on: boolean) => {
    const ids = on ? [...value, id] : value.filter((v) => v !== id);
    // Keep exactly one primary while any are chosen.
    const nextPrimary = ids.includes(primary) ? primary : (ids[0] ?? '');
    onChange(ids, nextPrimary);
  };

  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <RadioGroup
        value={primary}
        onValueChange={(p) => onChange(value, p)}
        aria-label="Primary specialization"
        className="gap-0 divide-y divide-border rounded-lg border border-border"
      >
        {options.map((t) => {
          const checked = value.includes(t.id);
          return (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox
                id={`spec-${t.id}`}
                checked={checked}
                onCheckedChange={(on) => toggle(t.id, on === true)}
                aria-describedby={error ? 'specializations-error' : undefined}
              />
              <label
                htmlFor={`spec-${t.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-sm"
              >
                <ColorDot color={t.color} />
                <span className="truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.code}</span>
                {!t.isActive && <Badge>Inactive</Badge>}
              </label>
              {checked && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RadioGroupItem value={t.id} aria-label={`Make ${t.name} primary`} />
                  Primary
                </label>
              )}
            </div>
          );
        })}
      </RadioGroup>
      {error ? (
        <p id="specializations-error" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          A therapist needs at least one active specialization to be booked. You can change these
          later; past sessions keep their therapy type.
        </p>
      )}
    </div>
  );
}

function AccountPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (membershipId: string) => void;
  error?: string;
}) {
  const staff = useStaff({ status: 'ACTIVE', pageSize: 100 });
  const options = (staff.data?.items ?? []).map((m) => ({
    value: m.id,
    label: m.fullName,
    description: `${roleLabels[m.role]} · ${m.email}`,
    keywords: [m.email],
    leading: <Avatar name={m.fullName} size="sm" />,
  }));
  return (
    <Field
      label="Staff account"
      optional
      error={error}
      className="sm:col-span-2"
      helper={
        <>
          Lets this person see their own profile and schedule when they sign in. Not needed for
          therapists who don’t use Carezino. To give someone access, first{' '}
          <Link href="/settings/staff" className="underline underline-offset-2">
            invite them as staff
          </Link>
          .
        </>
      }
    >
      <SearchableSelect
        options={options}
        value={value || undefined}
        onChange={(v) => onChange(v ?? '')}
        loading={staff.isPending}
        placeholder="Not linked"
        searchPlaceholder="Search staff"
        emptyText="No active staff found."
      />
    </Field>
  );
}

/**
 * One form for onboarding and editing a therapist. Weekly availability can be set while
 * onboarding, or later from the profile; editing manages it on the Availability tab.
 */
export function TherapistForm({ therapist }: { therapist?: TherapistDetail }) {
  const router = useRouter();
  const { can } = useSession();
  const editing = Boolean(therapist);
  const create = useCreateTherapist();
  const update = useUpdateTherapist();
  const setSpecializations = useSetSpecializations();
  const hours = useWorkingHours();
  const general = useGeneralSettings();
  const initial = React.useMemo(() => toValues(therapist), [therapist]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, setError, setValue } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const therapyTypeIds = useWatch({ control, name: 'therapyTypeIds' });
  const primaryTherapyTypeId = useWatch({ control, name: 'primaryTherapyTypeId' });

  const [setHoursNow, setSetHoursNow] = React.useState(false);
  const [week, setWeek] = React.useState<DayValue[]>(emptyWeek);
  const [weekErrors, setWeekErrors] = React.useState<Record<string, string>>({});
  const weekDirty = setHoursNow && week.some((d) => d.isAvailable);
  useUnsavedChanges(isDirty || weekDirty);
  const [leaving, setLeaving] = React.useState(false);
  const cancelHref = therapist ? therapistLinks.profile(therapist.id) : '/therapists';

  /** API errors onto fields; specializations.* and availability.* come prefixed on create. */
  const placeErrors = (error: unknown) => {
    if (!isApiError(error) || !error.errors) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
      return;
    }
    let placed = false;
    const hourErrors: Record<string, string> = {};
    for (const [path, message] of Object.entries(error.errors)) {
      if (path.startsWith('availability.')) {
        hourErrors[path.slice('availability.'.length)] = message;
        continue;
      }
      const field = path.replace(/^specializations\./, '') as FieldPath<Values>;
      if (!FIELDS.includes(field)) continue;
      setError(field, { type: 'server', message }, { shouldFocus: !placed });
      placed = true;
    }
    setWeekErrors(hourErrors);
    if (!placed) toast.error(error.message);
  };

  const onSubmit = handleSubmit(async (values) => {
    const specializations = values.therapyTypeIds.length
      ? { therapyTypeIds: values.therapyTypeIds, primaryTherapyTypeId: values.primaryTherapyTypeId }
      : { therapyTypeIds: [] };
    try {
      if (!therapist) {
        if (setHoursNow) {
          const found = validateWeek(week);
          setWeekErrors(found);
          if (Object.keys(found).length) {
            toast.error('Please fix the highlighted hours');
            return;
          }
        }
        const input = toInput(values);
        const created = await create.mutateAsync({
          ...input,
          // Blank optional fields are simply left out on create.
          email: input.email || undefined,
          gender: input.gender || undefined,
          photoUrl: input.photoUrl || undefined,
          employmentType: input.employmentType || undefined,
          status: values.status,
          specializations,
          ...(setHoursNow && { availability: { days: toAvailabilityInput(week) } }),
        });
        toast.success(`${created.fullName} added as ${created.code}`);
        router.push(therapistLinks.profile(created.id));
        return;
      }

      // Only what changed, so an unchanged field never overwrites someone else's edit.
      const before = toInput(initial);
      const after = toInput(values);
      const changed = Object.fromEntries(
        Object.entries(after).filter(
          ([key, value]) => value !== before[key as keyof TherapistInput],
        ),
      ) as Partial<TherapistInput>;
      if (Object.keys(changed).length) {
        await update.mutateAsync({ id: therapist.id, input: changed });
      }
      const specsChanged =
        JSON.stringify([...values.therapyTypeIds].sort()) !==
          JSON.stringify([...initial.therapyTypeIds].sort()) ||
        values.primaryTherapyTypeId !== initial.primaryTherapyTypeId;
      if (specsChanged) {
        await setSpecializations.mutateAsync({ id: therapist.id, input: specializations });
      }
      toast.success('Therapist saved');
      router.push(therapistLinks.profile(therapist.id));
    } catch (error) {
      placeErrors(error);
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="pt-6">
          <FormSection
            title="Basic information"
            description={
              therapist
                ? `Therapist ID ${therapist.code}. IDs are assigned automatically and never change.`
                : 'A therapist ID is assigned automatically when you save.'
            }
          >
            <Field
              label="Full name"
              required
              error={errors.fullName?.message}
              className="sm:col-span-2"
            >
              <Input
                autoComplete="off"
                placeholder="e.g. Dr. Farhana Rahman"
                {...register('fullName')}
              />
            </Field>
            <Field
              label="Mobile number"
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
            <Field label="Email" optional error={errors.email?.message}>
              <Input type="email" placeholder="name@example.com" {...register('email')} />
            </Field>
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <Field label="Gender" optional error={errors.gender?.message}>
                  <Select
                    value={field.value || 'none'}
                    onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {Object.entries(GENDERS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Field
              label="Profile photo"
              optional
              error={errors.photoUrl?.message}
              helper="Link to an image, e.g. from your website."
            >
              <Input inputMode="url" placeholder="https://…" {...register('photoUrl')} />
            </Field>
            {!editing && (
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3 sm:col-span-2">
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">Active</span>
                      <span className="text-xs text-muted-foreground">
                        Inactive therapists are kept on record but can’t be booked.
                      </span>
                    </span>
                    <Switch
                      checked={field.value === 'ACTIVE'}
                      onCheckedChange={(on) => field.onChange(on ? 'ACTIVE' : 'INACTIVE')}
                    />
                  </label>
                )}
              />
            )}
          </FormSection>

          <FormSection title="Professional information">
            <Field label="Designation" optional error={errors.designation?.message}>
              <Input placeholder="e.g. Senior Therapist" {...register('designation')} />
            </Field>
            <Controller
              control={control}
              name="employmentType"
              render={({ field }) => (
                <Field label="Employment type" optional error={errors.employmentType?.message}>
                  <Select
                    value={field.value || 'none'}
                    onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Field
              label="Registration number"
              optional
              error={errors.registrationNumber?.message}
              helper="Professional council or license number"
            >
              <Input {...register('registrationNumber')} />
            </Field>
            <Field label="Years of experience" optional error={errors.yearsOfExperience?.message}>
              <Input inputMode="numeric" placeholder="e.g. 5" {...register('yearsOfExperience')} />
            </Field>
            <Controller
              control={control}
              name="joiningDate"
              render={({ field }) => (
                <Field label="Joining date" optional error={errors.joiningDate?.message}>
                  <DatePicker
                    value={field.value || undefined}
                    onChange={(v) => field.onChange(v ?? '')}
                    withYearSelect
                  />
                </Field>
              )}
            />
            <Field
              label="Qualifications"
              optional
              error={errors.qualifications?.message}
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                placeholder="Degrees, certifications and training"
                {...register('qualifications')}
              />
            </Field>
            <Field label="Notes" optional error={errors.notes?.message} className="sm:col-span-2">
              <Textarea
                rows={3}
                placeholder="Internal notes for the center team"
                {...register('notes')}
              />
            </Field>
          </FormSection>

          <FormSection
            title="Specializations"
            description="The therapy types this therapist provides at your center. Mark one as primary."
          >
            <SpecializationPicker
              value={therapyTypeIds}
              primary={primaryTherapyTypeId}
              assigned={initial.therapyTypeIds}
              error={errors.therapyTypeIds?.message ?? errors.primaryTherapyTypeId?.message}
              onChange={(ids, primary) => {
                setValue('therapyTypeIds', ids, { shouldDirty: true, shouldValidate: true });
                setValue('primaryTherapyTypeId', primary, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            />
          </FormSection>

          {can('staff.read') && (
            <FormSection
              title="Sign-in access"
              description="Optional. A therapist profile works without a Carezino login."
            >
              <Controller
                control={control}
                name="membershipId"
                render={({ field }) => (
                  <AccountPicker
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.membershipId?.message}
                  />
                )}
              />
            </FormSection>
          )}

          {!editing && can('therapists.manage_availability') && (
            <section className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:gap-x-8">
              <div className="space-y-1">
                <h2 className="text-card-title">Weekly availability</h2>
                <p className="text-[13px] text-muted-foreground">
                  Optional now. You can set or change it any time from the therapist’s profile.
                </p>
              </div>
              <div className="grid min-w-0 gap-4">
                <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <span className="text-sm font-medium">Set weekly hours now</span>
                  <Switch checked={setHoursNow} onCheckedChange={setSetHoursNow} />
                </label>
                {setHoursNow && (
                  <AvailabilityEditor
                    value={week}
                    onChange={(next) => {
                      setWeek(next);
                      if (Object.keys(weekErrors).length) setWeekErrors(validateWeek(next));
                    }}
                    errors={weekErrors}
                    centerHours={hours.data?.days}
                    weekStartsOn={general.data?.weekStartsOn ?? 6}
                  />
                )}
              </div>
            </section>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => (isDirty || weekDirty ? setLeaving(true) : router.push(cancelHref))}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={editing && !isDirty}>
            {editing ? 'Save changes' : 'Add therapist'}
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
