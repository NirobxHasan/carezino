'use client';

import * as React from 'react';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Ellipsis,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Star,
  Unlink,
  UserCog,
} from 'lucide-react';
import { z } from 'zod';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  useLinkGuardian,
  useRecordConsent,
  useSetPrimaryContact,
  useUnlinkGuardian,
  useUpdateGuardian,
  useUpdateLink,
} from '@/lib/api/patients';
import { useGeneralSettings } from '@/lib/api/settings';
import { formatCenterDate, formatPhone } from '@/lib/format';
import { showFormError } from '@/lib/forms';
import { useSession } from '@/lib/session';
import type {
  ConsentPurpose,
  GuardianContactType,
  GuardianMatch,
  GuardianRelationship,
  PatientConsent,
  PatientContact,
  PatientDetail,
} from '@/lib/types';
import { anyMobile, optionalEmail, requiredText } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { GuardianMatches, SelectedGuardian } from './guardian-lookup';
import {
  CONSENT_PURPOSES,
  CONTACT_TYPES,
  RELATIONSHIPS,
  relationshipLabel,
} from './patient-display';

const optionalMobile = z
  .string()
  .trim()
  .refine((v) => v === '' || anyMobile.safeParse(v).success, {
    message: 'Enter a mobile number, e.g. 01712-345678, or +44… for numbers abroad',
  });

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm whitespace-pre-line', empty && 'text-subtle-foreground')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

function RelationshipSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: GuardianRelationship) => void;
  id?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as GuardianRelationship)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(RELATIONSHIPS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Add a contact ───────────────────────────────────────────────────────────

const addSchema = z
  .object({
    contactType: z.enum(['GUARDIAN', 'CAREGIVER']),
    guardianId: z.string(),
    fullName: z.string().trim().max(120),
    mobile: optionalMobile,
    secondaryMobile: optionalMobile,
    email: optionalEmail,
    address: z.string().trim().max(500),
    relationship: z.string().min(1, 'Choose a relationship'),
    customRelationship: z.string().trim().max(60),
    isEmergencyContact: z.boolean(),
    isPrimary: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.guardianId && !v.fullName)
      ctx.addIssue({ code: 'custom', path: ['fullName'], message: 'Contact name is required' });
    if (!v.guardianId && !v.mobile)
      ctx.addIssue({ code: 'custom', path: ['mobile'], message: 'Mobile number is required' });
    if (v.relationship === 'OTHER' && !v.customRelationship)
      ctx.addIssue({
        code: 'custom',
        path: ['customRelationship'],
        message: 'Describe the relationship',
      });
  });
type AddValues = z.input<typeof addSchema>;
// guardianId has no visible field, so its errors (e.g. already linked) go to a toast.
const ADD_FIELDS = (Object.keys(addSchema.shape) as FieldPath<AddValues>[]).filter(
  (f) => f !== 'guardianId',
);
const ADD_DEFAULTS: AddValues = {
  contactType: 'GUARDIAN',
  guardianId: '',
  fullName: '',
  mobile: '',
  secondaryMobile: '',
  email: '',
  address: '',
  relationship: '',
  customRelationship: '',
  isEmergencyContact: false,
  isPrimary: false,
};

function AddContactDialog({
  patient,
  open,
  onOpenChange,
}: {
  patient: PatientDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const link = useLinkGuardian();
  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: ADD_DEFAULTS,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, setError, setValue, reset } = form;
  const { errors, isSubmitting } = formState;
  const [mobile, relationship] = useWatch({ control, name: ['mobile', 'relationship'] });
  const [chosen, setChosen] = React.useState<GuardianMatch | null>(null);

  // Start empty next time.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset(ADD_DEFAULTS);
      setChosen(null);
    }
    onOpenChange(next);
  };

  const choose = (g: GuardianMatch | null) => {
    setChosen(g);
    setValue('guardianId', g?.id ?? '');
  };

  const onSubmit = handleSubmit(async (v) => {
    try {
      await link.mutateAsync({
        id: patient.id,
        input: {
          contactType: v.contactType,
          ...(v.guardianId
            ? { guardianId: v.guardianId }
            : {
                fullName: v.fullName.trim(),
                mobile: v.mobile.trim(),
                secondaryMobile: v.secondaryMobile.trim() || undefined,
                email: v.email.trim() || undefined,
                address: v.address.trim() || undefined,
              }),
          relationship: v.relationship as GuardianRelationship,
          customRelationship: v.relationship === 'OTHER' ? v.customRelationship.trim() : undefined,
          isEmergencyContact: v.isEmergencyContact,
          isPrimary: v.isPrimary,
        },
      });
      toast.success(`${chosen?.fullName ?? v.fullName.trim()} added as a contact`);
      handleOpenChange(false);
    } catch (error) {
      showFormError(error, setError, ADD_FIELDS);
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a contact for {patient.fullName}</DialogTitle>
            <DialogDescription>
              A parent, guardian or another caregiver. Start with their mobile to find someone
              already on record, such as a sibling’s parent.
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={control}
            name="contactType"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                aria-label="Contact type"
                className="grid gap-2 sm:grid-cols-2"
              >
                {(['GUARDIAN', 'CAREGIVER'] as const).map((type) => (
                  <RadioCard
                    key={type}
                    value={type}
                    title={CONTACT_TYPES[type].label}
                    description={CONTACT_TYPES[type].description}
                  />
                ))}
              </RadioGroup>
            )}
          />
          {chosen ? (
            <SelectedGuardian guardian={chosen} onClear={() => choose(null)} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile" required error={errors.mobile?.message}>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="01712-345678"
                  {...register('mobile')}
                />
              </Field>
              <Field label="Contact name" required error={errors.fullName?.message}>
                <Input autoComplete="off" {...register('fullName')} />
              </Field>
              <GuardianMatches
                mobile={mobile}
                onSelect={choose}
                excludeIds={patient.contacts.map((c) => c.guardianId)}
                className="sm:col-span-2"
              />
              <Field label="Secondary mobile" optional error={errors.secondaryMobile?.message}>
                <Input type="tel" inputMode="tel" {...register('secondaryMobile')} />
              </Field>
              <Field label="Email" optional error={errors.email?.message}>
                <Input type="email" {...register('email')} />
              </Field>
              <Field
                label="Address"
                optional
                error={errors.address?.message}
                className="sm:col-span-2"
              >
                <Textarea rows={2} {...register('address')} />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="relationship"
              render={({ field }) => (
                <Field
                  label="Relationship to patient"
                  required
                  error={errors.relationship?.message}
                >
                  <RelationshipSelect value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
            {relationship === 'OTHER' && (
              <Field label="Relationship" required error={errors.customRelationship?.message}>
                <Input placeholder="e.g. Uncle" {...register('customRelationship')} />
              </Field>
            )}
          </div>
          <div className="grid gap-2">
            <Controller
              control={control}
              name="isEmergencyContact"
              render={({ field }) => (
                <label className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(on) => field.onChange(on === true)}
                  />
                  Emergency contact
                </label>
              )}
            />
            <Controller
              control={control}
              name="isPrimary"
              render={({ field }) => (
                <label className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(on) => field.onChange(on === true)}
                  />
                  Make them the primary contact
                </label>
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Relationship to this patient ────────────────────────────────────────────

const linkSchema = z
  .object({
    contactType: z.enum(['GUARDIAN', 'CAREGIVER']),
    relationship: z.string().min(1, 'Choose a relationship'),
    customRelationship: z.string().trim().max(60),
    isEmergencyContact: z.boolean(),
  })
  .refine((v) => v.relationship !== 'OTHER' || v.customRelationship, {
    path: ['customRelationship'],
    message: 'Describe the relationship',
  });
type LinkValues = z.input<typeof linkSchema>;

function EditRelationshipDialog({
  patient,
  contact,
  onClose,
}: {
  patient: PatientDetail;
  contact: PatientContact | null;
  onClose: () => void;
}) {
  const update = useUpdateLink();
  const form = useForm<LinkValues>({ resolver: zodResolver(linkSchema), mode: 'onTouched' });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const relationship = useWatch({ control, name: 'relationship' });

  React.useEffect(() => {
    if (contact)
      reset({
        contactType: contact.contactType,
        relationship: contact.relationship,
        customRelationship: contact.customRelationship ?? '',
        isEmergencyContact: contact.isEmergencyContact,
      });
  }, [contact, reset]);

  const onSubmit = handleSubmit(async (v) => {
    if (!contact) return;
    try {
      await update.mutateAsync({
        id: patient.id,
        relationId: contact.relationId,
        input: {
          contactType: v.contactType,
          relationship: v.relationship as GuardianRelationship,
          customRelationship: v.relationship === 'OTHER' ? v.customRelationship.trim() : null,
          isEmergencyContact: v.isEmergencyContact,
        },
      });
      toast.success('Relationship saved');
      onClose();
    } catch (error) {
      showFormError(error, setError, ['relationship', 'customRelationship', 'contactType']);
    }
  });

  return (
    <Dialog open={Boolean(contact)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {contact?.guardian.fullName} and {patient.fullName}
            </DialogTitle>
            <DialogDescription>
              How they’re related to this patient only. Their other patients aren’t affected.
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={control}
            name="contactType"
            render={({ field }) => (
              <Field label="Contact type" required>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['GUARDIAN', 'CAREGIVER'] as GuardianContactType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {CONTACT_TYPES[t].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="relationship"
            render={({ field }) => (
              <Field label="Relationship" required error={formState.errors.relationship?.message}>
                <RelationshipSelect value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          {relationship === 'OTHER' && (
            <Field
              label="Describe the relationship"
              required
              error={formState.errors.customRelationship?.message}
            >
              <Input placeholder="e.g. Uncle" {...register('customRelationship')} />
            </Field>
          )}
          <Controller
            control={control}
            name="isEmergencyContact"
            render={({ field }) => (
              <label className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(on) => field.onChange(on === true)}
                />
                Emergency contact
              </label>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── The guardian's own details ──────────────────────────────────────────────

const guardianSchema = z.object({
  fullName: requiredText('Contact name').max(120),
  mobile: anyMobile,
  secondaryMobile: optionalMobile,
  email: optionalEmail,
  address: z.string().trim().max(500),
});
type GuardianValues = z.input<typeof guardianSchema>;
const GUARDIAN_FIELDS = Object.keys(guardianSchema.shape);

function EditGuardianDialog({
  contact,
  onClose,
}: {
  contact: PatientContact | null;
  onClose: () => void;
}) {
  const update = useUpdateGuardian();
  const form = useForm<GuardianValues>({
    resolver: zodResolver(guardianSchema),
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, setError, reset } = form;
  const { errors } = formState;
  const shared = (contact?.guardian.linkedPatientCount ?? 0) - 1;

  React.useEffect(() => {
    if (contact) {
      const g = contact.guardian;
      reset({
        fullName: g.fullName,
        mobile: g.mobile,
        secondaryMobile: g.secondaryMobile ?? '',
        email: g.email ?? '',
        address: g.address ?? '',
      });
    }
  }, [contact, reset]);

  const onSubmit = handleSubmit(async (v) => {
    if (!contact) return;
    const g = contact.guardian;
    const before: GuardianValues = {
      fullName: g.fullName,
      mobile: g.mobile,
      secondaryMobile: g.secondaryMobile ?? '',
      email: g.email ?? '',
      address: g.address ?? '',
    };
    const changed = Object.fromEntries(
      Object.entries(v)
        .map(([k, value]) => [k, value.trim()])
        .filter(([k, value]) => value !== before[k as keyof GuardianValues]),
    );
    try {
      if (Object.keys(changed).length)
        await update.mutateAsync({ guardianId: contact.guardianId, input: changed });
      toast.success(`${v.fullName.trim()}’s details saved`);
      onClose();
    } catch (error) {
      showFormError(error, setError, GUARDIAN_FIELDS);
    }
  });

  return (
    <Dialog open={Boolean(contact)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {contact?.guardian.fullName}’s details</DialogTitle>
            <DialogDescription>Their name and how to reach them.</DialogDescription>
          </DialogHeader>
          {shared > 0 && (
            <div
              role="note"
              className="flex gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-[13px] text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <span className="font-medium">Shared contact.</span> {contact?.guardian.fullName} is
                also a contact for {shared} other {shared === 1 ? 'patient' : 'patients'}. Changes
                here apply to all of them. If this is a different person, add them as a new contact
                instead.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Full name"
              required
              error={errors.fullName?.message}
              className="sm:col-span-2"
            >
              <Input {...register('fullName')} />
            </Field>
            <Field label="Mobile" required error={errors.mobile?.message}>
              <Input type="tel" inputMode="tel" {...register('mobile')} />
            </Field>
            <Field label="Secondary mobile" optional error={errors.secondaryMobile?.message}>
              <Input type="tel" inputMode="tel" {...register('secondaryMobile')} />
            </Field>
            <Field label="Email" optional error={errors.email?.message} className="sm:col-span-2">
              <Input type="email" {...register('email')} />
            </Field>
            <Field
              label="Address"
              optional
              error={errors.address?.message}
              className="sm:col-span-2"
            >
              <Textarea rows={2} {...register('address')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
              {shared > 0 ? `Save for all ${shared + 1} patients` : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Contacts card ───────────────────────────────────────────────────────────

function ContactRow({ contact, actions }: { contact: PatientContact; actions?: React.ReactNode }) {
  const g = contact.guardian;
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Avatar name={g.fullName} size="sm" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {g.fullName}
          {contact.isPrimary && (
            <Badge tone="primary">
              <Star aria-hidden /> Primary
            </Badge>
          )}
          {contact.isEmergencyContact && <Badge tone="warning">Emergency</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {relationshipLabel(contact)} · {CONTACT_TYPES[contact.contactType].label}
          {g.linkedPatientCount > 1 && ` · contact for ${g.linkedPatientCount} patients`}
        </p>
        <p className="text-[13px] tabular">
          <a href={`tel:${g.mobile}`} className="rounded hover:underline focus-ring">
            {formatPhone(g.mobile)}
          </a>
          {g.secondaryMobile && (
            <span className="text-muted-foreground"> · {formatPhone(g.secondaryMobile)}</span>
          )}
        </p>
        {(g.email || g.address) && (
          <p className="truncate text-xs text-muted-foreground">
            {[g.email, g.address].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {actions}
    </li>
  );
}

export function ContactsCard({ patient }: { patient: PatientDetail }) {
  const { can } = useSession();
  const setPrimary = useSetPrimaryContact();
  const unlink = useUnlinkGuardian();
  const [adding, setAdding] = React.useState(false);
  const [editingLink, setEditingLink] = React.useState<PatientContact | null>(null);
  const [editingGuardian, setEditingGuardian] = React.useState<PatientContact | null>(null);
  const [primaryTarget, setPrimaryTarget] = React.useState<PatientContact | 'self' | null>(null);
  const [unlinkTarget, setUnlinkTarget] = React.useState<PatientContact | null>(null);
  const canManage = can('guardians.update');
  const primaryName =
    primaryTarget === 'self' ? patient.fullName : primaryTarget?.guardian.fullName;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Contacts</CardTitle>
        {can('guardians.create') && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add contact
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {patient.primaryContactIsSelf && (
          <div className="flex gap-3 rounded-lg border border-border p-3">
            <Avatar name={patient.fullName} size="sm" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                Patient (self)
                <Badge tone="primary">
                  <Star aria-hidden /> Primary
                </Badge>
              </p>
              <p className="text-[13px] tabular">{patient.mobile && formatPhone(patient.mobile)}</p>
            </div>
          </div>
        )}
        {patient.contacts.length > 0 ? (
          <ul className="divide-y divide-border">
            {patient.contacts.map((c) => (
              <ContactRow
                key={c.relationId}
                contact={c}
                actions={
                  canManage || can('guardians.unlink') ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${c.guardian.fullName}`}
                        >
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canManage && (
                          <>
                            <DropdownMenuItem onSelect={() => setEditingLink(c)}>
                              <UserCog /> Edit relationship
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditingGuardian(c)}>
                              <Pencil /> Edit contact details
                            </DropdownMenuItem>
                            {!c.isPrimary && (
                              <DropdownMenuItem onSelect={() => setPrimaryTarget(c)}>
                                <Star /> Make primary contact
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {can('guardians.unlink') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              tone="danger"
                              disabled={c.isPrimary}
                              onSelect={() => setUnlinkTarget(c)}
                            >
                              <Unlink /> Remove from patient
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : undefined
                }
              />
            ))}
          </ul>
        ) : (
          !patient.primaryContactIsSelf && <EmptyState compact title="No contacts yet" />
        )}
        {patient.contacts.some((c) => c.isPrimary) && can('guardians.unlink') && (
          <p className="text-xs text-muted-foreground">
            To remove the primary contact, make someone else primary first.
          </p>
        )}
        {canManage && !patient.primaryContactIsSelf && patient.mobile && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setPrimaryTarget('self')}
          >
            <Star /> Make the patient their own primary contact
          </Button>
        )}
        {(patient.emergencyPhone || (!patient.primaryContactIsSelf && patient.mobile)) && (
          <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {patient.emergencyPhone && (
              <Detail label="Emergency phone">
                <span className="inline-flex items-center gap-1.5 tabular">
                  <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                  {formatPhone(patient.emergencyPhone)}
                </span>
              </Detail>
            )}
            {!patient.primaryContactIsSelf && patient.mobile && (
              <Detail label="Patient’s own mobile">{formatPhone(patient.mobile)}</Detail>
            )}
          </dl>
        )}
      </CardContent>
      <AddContactDialog patient={patient} open={adding} onOpenChange={setAdding} />
      <EditRelationshipDialog
        patient={patient}
        contact={editingLink}
        onClose={() => setEditingLink(null)}
      />
      <EditGuardianDialog contact={editingGuardian} onClose={() => setEditingGuardian(null)} />
      <ConfirmDialog
        open={Boolean(primaryTarget)}
        onOpenChange={(o) => !o && setPrimaryTarget(null)}
        title={`Make ${primaryName} the primary contact?`}
        description="They’ll be shown first and called first. The other contacts stay linked."
        confirmLabel="Make primary"
        loading={setPrimary.isPending}
        onConfirm={() => {
          if (!primaryTarget) return;
          setPrimary.mutate(
            {
              id: patient.id,
              target:
                primaryTarget === 'self'
                  ? { self: true }
                  : { relationId: primaryTarget.relationId },
            },
            {
              onSuccess: () => {
                toast.success(`${primaryName} is now the primary contact`);
                setPrimaryTarget(null);
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(unlinkTarget)}
        onOpenChange={(o) => !o && setUnlinkTarget(null)}
        title={`Remove ${unlinkTarget?.guardian.fullName} from ${patient.fullName}?`}
        description="Only the link to this patient is removed. Their record, other patients and any consent they gave are kept."
        confirmLabel="Remove contact"
        tone="danger"
        loading={unlink.isPending}
        onConfirm={() => {
          if (!unlinkTarget) return;
          unlink.mutate(
            { id: patient.id, relationId: unlinkTarget.relationId },
            {
              onSuccess: () => {
                toast.success(`${unlinkTarget.guardian.fullName} removed`);
                setUnlinkTarget(null);
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      />
    </Card>
  );
}

// ── Consent ─────────────────────────────────────────────────────────────────

const consentSchema = z.object({
  purpose: z.string().min(1, 'Choose what consent is for'),
  granted: z.enum(['yes', 'no']),
  givenBy: z.string().min(1, 'Choose who gave consent'),
  version: z.string().trim().max(100),
  note: z.string().trim().max(500),
});
type ConsentValues = z.input<typeof consentSchema>;

function RecordConsentDialog({
  patient,
  open,
  onOpenChange,
}: {
  patient: PatientDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const record = useRecordConsent();
  const form = useForm<ConsentValues>({ resolver: zodResolver(consentSchema), mode: 'onTouched' });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const people = [
    { value: 'self', label: `${patient.fullName} (patient)` },
    ...patient.contacts.map((c) => ({
      value: c.guardianId,
      label: `${c.guardian.fullName} (${relationshipLabel(c)})`,
    })),
  ];
  const defaultGiver = patient.primaryContactIsSelf
    ? 'self'
    : (patient.contacts.find((c) => c.isPrimary)?.guardianId ?? 'self');

  React.useEffect(() => {
    if (open) reset({ purpose: '', granted: 'yes', givenBy: defaultGiver, version: '', note: '' });
  }, [open, reset, defaultGiver]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await record.mutateAsync({
        id: patient.id,
        input: {
          purpose: v.purpose as ConsentPurpose,
          granted: v.granted === 'yes',
          givenBy: v.givenBy === 'self' ? 'SELF' : 'GUARDIAN',
          guardianId: v.givenBy === 'self' ? undefined : v.givenBy,
          version: v.version.trim() || undefined,
          note: v.note.trim() || undefined,
        },
      });
      toast.success(v.granted === 'yes' ? 'Consent recorded' : 'Refusal recorded');
      onOpenChange(false);
    } catch (error) {
      showFormError(error, setError, ['purpose', 'version', 'note']);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Record consent</DialogTitle>
            <DialogDescription>
              Adds to the history; earlier records are kept. Keep the signed form as well.
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={control}
            name="purpose"
            render={({ field }) => (
              <Field label="Consent for" required error={formState.errors.purpose?.message}>
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONSENT_PURPOSES).map(([value, p]) => (
                      <SelectItem key={value} value={value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="granted"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                aria-label="Decision"
                className="grid gap-2 sm:grid-cols-2"
              >
                <RadioCard value="yes" title="Given" />
                <RadioCard value="no" title="Refused or withdrawn" />
              </RadioGroup>
            )}
          />
          <Controller
            control={control}
            name="givenBy"
            render={({ field }) => (
              <Field label="Given by" required error={formState.errors.givenBy?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Field label="Form or version" optional error={formState.errors.version?.message}>
            <Input placeholder="e.g. Registration form v2" {...register('version')} />
          </Field>
          <Field label="Note" optional error={formState.errors.note?.message}>
            <Textarea rows={2} {...register('note')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The latest record per purpose is the current state; older ones are history. */
export function ConsentCard({ patient }: { patient: PatientDetail }) {
  const { can } = useSession();
  const general = useGeneralSettings();
  const [recording, setRecording] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const current = new Map<ConsentPurpose, PatientConsent>();
  for (const c of patient.consents) if (!current.has(c.purpose)) current.set(c.purpose, c);
  const date = (v: string) => formatCenterDate(v, general.data?.dateFormat);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Consent</CardTitle>
        {can('patients.update') && (
          <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
            <ShieldCheck /> Record consent
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2">
          {(Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]).map((purpose) => {
            const c = current.get(purpose);
            return (
              <li key={purpose} className="flex items-start justify-between gap-3 text-sm">
                <span className="grid gap-0.5">
                  <span>{CONSENT_PURPOSES[purpose].label}</span>
                  {c && (
                    <span className="text-xs text-muted-foreground">
                      {c.givenByName} · {date(c.recordedAt)}
                      {c.version && ` · ${c.version}`}
                    </span>
                  )}
                </span>
                {!c ? (
                  <Badge>Not recorded</Badge>
                ) : c.granted ? (
                  <Badge tone="success">Given</Badge>
                ) : (
                  <Badge tone="danger">Refused</Badge>
                )}
              </li>
            );
          })}
        </ul>
        {patient.consents.length > current.size && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setShowHistory((s) => !s)}
            aria-expanded={showHistory}
          >
            {showHistory ? 'Hide history' : `Show full history (${patient.consents.length})`}
          </Button>
        )}
        {showHistory && (
          <ol className="grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            {patient.consents.map((c) => (
              <li key={c.id}>
                <span className="text-foreground">
                  {CONSENT_PURPOSES[c.purpose].label}:{' '}
                  {c.granted ? 'given' : 'refused or withdrawn'}
                </span>{' '}
                by {c.givenByName} on {date(c.recordedAt)}, recorded by {c.recordedBy.fullName}
                {c.version && ` · ${c.version}`}
                {c.note && ` · “${c.note}”`}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      <RecordConsentDialog patient={patient} open={recording} onOpenChange={setRecording} />
    </Card>
  );
}
