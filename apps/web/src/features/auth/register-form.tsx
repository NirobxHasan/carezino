'use client';

import type * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { InlineLoader } from '@/components/feedback/states';
import { Field, FormSection } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterCenter, useRegistrationStatus } from '@/lib/api/auth';
import { showFormError } from '@/lib/forms';
import { DEFAULT_CENTER_SETTINGS } from '@/lib/locale-options';
import {
  anyPhone,
  bdPhone,
  newPassword,
  optionalEmail,
  optionalUrl,
  requiredText,
} from '@/lib/validation';
import { CurrencySelect, DistrictSuggestions, TimezoneSelect } from './center-fields';

const schema = z
  .object({
    center: z.object({
      name: requiredText('Center name').max(150),
      phone: anyPhone,
      email: optionalEmail,
      address: requiredText('Address').max(500),
      district: z.string().trim().max(80),
      country: requiredText('Country').max(80),
      timezone: requiredText('Time zone'),
      currency: requiredText('Currency'),
      website: optionalUrl,
    }),
    owner: z.object({
      fullName: requiredText('Full name').max(120),
      email: z.email('Enter a valid email address'),
      mobile: bdPhone,
      password: newPassword,
      confirmPassword: z.string().min(1, 'Confirm your password'),
    }),
    /** Start with OT, ABA and SLT as editable therapy types */
    defaultTherapyTypes: z.boolean(),
  })
  .refine((v) => v.owner.password === v.owner.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['owner', 'confirmPassword'],
  });

type Values = z.input<typeof schema>;

const FIELDS = [
  'center.name',
  'center.phone',
  'center.email',
  'center.address',
  'center.district',
  'center.country',
  'center.timezone',
  'center.currency',
  'center.website',
  'owner.fullName',
  'owner.email',
  'owner.mobile',
  'owner.password',
  'owner.confirmPassword',
] as const;

export type CenterRegistrationValues = Values;

const defaults: Values = {
  center: {
    name: '',
    phone: '',
    email: '',
    address: '',
    district: '',
    website: '',
    ...DEFAULT_CENTER_SETTINGS,
  },
  owner: { fullName: '', email: '', mobile: '', password: '', confirmPassword: '' },
  defaultTherapyTypes: true,
};

/**
 * The center + first administrator form. Used by the super admin (`variant="platform"`)
 * and, when public signup is enabled, by the center's owner (`variant="self"`).
 */
export function CenterRegistrationForm({
  variant,
  onSubmit: submit,
  footer,
}: {
  variant: 'self' | 'platform';
  onSubmit: (values: Values) => Promise<void>;
  /** Extra buttons placed before the submit button, e.g. Cancel */
  footer?: React.ReactNode;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, setError } = form;
  const { errors, isSubmitting } = formState;
  const e = errors.center ?? {};
  const o = errors.owner ?? {};
  const self = variant === 'self';

  const onSubmit = handleSubmit(async (values) => {
    try {
      await submit(values);
    } catch (error) {
      showFormError(error, setError, FIELDS);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormSection
        title="Center information"
        description="Shown to the center’s team. A center code is generated automatically."
      >
        <Field label="Center name" required error={e.name?.message} className="sm:col-span-2">
          <Input autoComplete="organization" {...register('center.name')} />
        </Field>
        <Field label="Contact phone" required error={e.phone?.message}>
          <Input
            type="tel"
            inputMode="tel"
            placeholder="01712-345678"
            {...register('center.phone')}
          />
        </Field>
        <Field label="Center email" optional error={e.email?.message}>
          <Input type="email" autoComplete="off" {...register('center.email')} />
        </Field>
        <Field label="Address" required error={e.address?.message} className="sm:col-span-2">
          <Textarea rows={2} autoComplete="street-address" {...register('center.address')} />
        </Field>
        <Field label="District" optional error={e.district?.message}>
          <Input list="register-districts" autoComplete="off" {...register('center.district')} />
        </Field>
        <DistrictSuggestions id="register-districts" />
        <Field label="Country" required error={e.country?.message}>
          <Input autoComplete="country-name" {...register('center.country')} />
        </Field>
        <Field label="Time zone" required error={e.timezone?.message}>
          <TimezoneSelect control={control} name="center.timezone" />
        </Field>
        <Field label="Currency" required error={e.currency?.message}>
          <CurrencySelect control={control} name="center.currency" />
        </Field>
        <Field label="Website" optional error={e.website?.message} className="sm:col-span-2">
          <Input inputMode="url" placeholder="yourcenter.com" {...register('center.website')} />
        </Field>
      </FormSection>

      <FormSection
        title={self ? 'Your details' : 'Center administrator'}
        description={
          self
            ? 'You’ll be the center’s first administrator. You can invite your team next.'
            : 'The owner or manager who runs the center in Carezino and invites its staff.'
        }
      >
        <Field label="Full name" required error={o.fullName?.message} className="sm:col-span-2">
          <Input autoComplete={self ? 'name' : 'off'} {...register('owner.fullName')} />
        </Field>
        <Field
          label="Email"
          required
          error={o.email?.message}
          helper={self ? 'You’ll sign in with this.' : 'They sign in with this.'}
        >
          <Input type="email" autoComplete={self ? 'email' : 'off'} {...register('owner.email')} />
        </Field>
        <Field label="Mobile number" required error={o.mobile?.message}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete={self ? 'tel' : 'off'}
            placeholder="01712-345678"
            {...register('owner.mobile')}
          />
        </Field>
      </FormSection>

      <FormSection
        title={self ? 'Password' : 'Initial password'}
        description={
          self
            ? 'At least 8 characters. A short phrase works well.'
            : 'At least 8 characters. Share it with the administrator privately; they can change it from My profile.'
        }
      >
        <Field label="Password" required error={o.password?.message}>
          <PasswordInput autoComplete="new-password" {...register('owner.password')} />
        </Field>
        <Field label="Confirm password" required error={o.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...register('owner.confirmPassword')} />
        </Field>
      </FormSection>

      {!self && (
        <FormSection
          title="Starting setup"
          description="Working hours (Saturday to Thursday, 9 am to 6 pm) and booking settings are always added. The center can change everything later."
        >
          <Controller
            control={control}
            name="defaultTherapyTypes"
            render={({ field }) => (
              <label className="flex items-start gap-3 sm:col-span-2">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Add standard therapy types</span>
                  <span className="text-xs text-muted-foreground">
                    Occupational Therapy (OT), Applied Behavior Analysis (ABA) and Speech &amp;
                    Language Therapy (SLT), as editable records.
                  </span>
                </span>
              </label>
            )}
          />
        </FormSection>
      )}

      <div className="flex flex-col-reverse items-stretch gap-3 pt-6 sm:flex-row sm:justify-end">
        {footer}
        <Button type="submit" size="lg" loading={isSubmitting}>
          {self ? 'Create center' : 'Register center'}
        </Button>
      </div>
    </form>
  );
}

/** Public self-service signup at /register; only open when the API allows it. */
export function RegisterForm() {
  const router = useRouter();
  const status = useRegistrationStatus();
  const registerCenter = useRegisterCenter();

  if (status.isPending) {
    return <InlineLoader />;
  }
  if (!status.data?.enabled) {
    return (
      <AuthCard
        title="Registration is closed"
        footer={
          <Link
            href="/login"
            className="rounded font-medium text-primary hover:underline focus-ring"
          >
            Back to sign in
          </Link>
        }
      >
        <FormAlert>
          New therapy centers are registered by the Carezino team. Contact us to get your center set
          up.
        </FormAlert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      wide
      title="Register your therapy center"
      description="Set up your center and its administrator account. It takes about two minutes."
      footer={
        <>
          Already registered?{' '}
          <Link
            href="/login"
            className="rounded font-medium text-primary hover:underline focus-ring"
          >
            Sign in
          </Link>
        </>
      }
    >
      <CenterRegistrationForm
        variant="self"
        onSubmit={async (values) => {
          await registerCenter.mutateAsync(values);
          router.replace('/dashboard');
        }}
      />
    </AuthCard>
  );
}
