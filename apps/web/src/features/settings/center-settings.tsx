'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field, FormSection } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { CurrencySelect, DistrictSuggestions, TimezoneSelect } from '@/features/auth/center-fields';
import { useCurrentCenter, useUpdateCenter } from '@/lib/api/staff';
import { showFormError } from '@/lib/forms';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type { CenterProfile } from '@/lib/types';
import { anyPhone, optionalEmail, optionalUrl, requiredText } from '@/lib/validation';

const schema = z.object({
  name: requiredText('Center name').max(150),
  phone: anyPhone,
  email: optionalEmail,
  address: requiredText('Address').max(500),
  district: z.string().trim().max(80),
  website: optionalUrl,
  logoUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'Enter an https:// image URL'),
  timezone: requiredText('Time zone'),
  currency: requiredText('Currency'),
});

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(c: CenterProfile): Values {
  return {
    name: c.name,
    phone: c.phone,
    email: c.email ?? '',
    address: c.address,
    district: c.district ?? '',
    website: c.website ?? '',
    logoUrl: c.logoUrl ?? '',
    timezone: c.timezone,
    currency: c.currency,
  };
}

function CenterForm({ center }: { center: CenterProfile }) {
  const { can } = useSession();
  const editable = can('center.update');
  const update = useUpdateCenter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(center),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const { errors, isDirty, isSubmitting, dirtyFields } = formState;
  useUnsavedChanges(isDirty);

  const onSubmit = handleSubmit(async (values) => {
    // Send only what changed; empty optional fields clear the stored value.
    const changed = Object.fromEntries(
      Object.entries(values).filter(([key]) => dirtyFields[key as keyof Values]),
    );
    try {
      const saved = await update.mutateAsync(changed);
      reset(toValues(saved));
      toast.success('Center profile saved');
    } catch (error) {
      showFormError(error, setError, FIELDS);
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="contents">
          <CardContent className="pt-6">
            {!editable && (
              <p className="mb-5 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                Only center administrators can change these details.
              </p>
            )}
            <FormSection title="Center" description="Your center’s name and how people reach it.">
              <Field
                label="Center name"
                required
                error={errors.name?.message}
                className="sm:col-span-2"
              >
                <Input autoComplete="organization" {...register('name')} />
              </Field>
              <Field label="Center code" helper="Assigned at registration. It can’t be changed.">
                <Input value={center.code} readOnly disabled className="tabular" />
              </Field>
              <Field label="Contact phone" required error={errors.phone?.message}>
                <Input type="tel" inputMode="tel" {...register('phone')} />
              </Field>
              <Field label="Email" optional error={errors.email?.message}>
                <Input type="email" {...register('email')} />
              </Field>
              <Field label="Website" optional error={errors.website?.message}>
                <Input inputMode="url" placeholder="yourcenter.com" {...register('website')} />
              </Field>
              <Field
                label="Logo URL"
                optional
                error={errors.logoUrl?.message}
                helper="Link to an image hosted elsewhere (https). Uploads are coming later."
                className="sm:col-span-2"
              >
                <Input inputMode="url" placeholder="https://…" {...register('logoUrl')} />
              </Field>
            </FormSection>
            <FormSection title="Location" description="One location for now.">
              <Field
                label="Address"
                required
                error={errors.address?.message}
                className="sm:col-span-2"
              >
                <Textarea rows={2} {...register('address')} />
              </Field>
              <Field label="District" optional error={errors.district?.message}>
                <Input list="center-districts" autoComplete="off" {...register('district')} />
              </Field>
              <DistrictSuggestions id="center-districts" />
              <Field label="Country" helper="Set at registration.">
                <Input value={center.country} readOnly disabled />
              </Field>
            </FormSection>
            <FormSection
              title="Regional settings"
              description="Used for appointment times, receipts and reports."
            >
              <Field label="Time zone" required error={errors.timezone?.message}>
                <TimezoneSelect control={control} name="timezone" disabled={!editable} />
              </Field>
              <Field label="Currency" required error={errors.currency?.message}>
                <CurrencySelect control={control} name="currency" disabled={!editable} />
              </Field>
            </FormSection>
          </CardContent>
          {editable && (
            <CardFooter className="justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={!isDirty || isSubmitting}
                onClick={() => reset(toValues(center))}
              >
                Discard changes
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
            </CardFooter>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

export function CenterSettings() {
  const { data, isPending, error, refetch } = useCurrentCenter();
  return (
    <RequirePermission permission="center.read">
      {isPending ? (
        <PageSkeleton />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        // Keyed so a refetch after saving starts the form from the saved values.
        <CenterForm key={data.updatedAt} center={data} />
      )}
    </RequirePermission>
  );
}
