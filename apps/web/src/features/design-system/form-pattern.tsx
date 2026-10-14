'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { startOfToday } from 'date-fns';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { DatePicker } from '@/components/forms/date-picker';
import { Field, FormSection } from '@/components/forms/field';
import { MultiSelect } from '@/components/forms/searchable-select';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { bdPhone, isoDate, optionalEmail, requiredText } from '@/lib/validation';

const schema = z.object({
  fullName: requiredText('Patient name'),
  dateOfBirth: isoDate('Date of birth'),
  gender: z.enum(['female', 'male', 'other'], { error: 'Select a gender' }),
  guardianName: requiredText('Guardian name'),
  guardianPhone: bdPhone,
  guardianEmail: optionalEmail,
  therapies: z.array(z.string()).min(1, 'Choose at least one therapy'),
});

type Values = z.input<typeof schema>;

const defaults: Values = {
  fullName: '',
  dateOfBirth: '',
  gender: undefined as unknown as Values['gender'],
  guardianName: '',
  guardianPhone: '',
  guardianEmail: '',
  therapies: [],
};

/**
 * Reference implementation for module forms: React Hook Form + Zod, labels above
 * inputs, inline errors on submit then on change, focus on the first error, a
 * disabled-while-saving submit, and a guard against losing unsaved changes.
 */
export function FormPattern() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset } = form;
  const { errors, isDirty, isSubmitting } = formState;
  const [discardOpen, setDiscardOpen] = React.useState(false);
  useUnsavedChanges(isDirty);

  const onSubmit = handleSubmit(async (values) => {
    await new Promise((r) => setTimeout(r, 600));
    toast.success('Form is valid', { description: `${values.fullName} would be saved.` });
    reset(defaults);
  });

  return (
    <section>
      <SectionHeader
        title="Form pattern"
        description="Copy this structure for module forms. Try submitting it empty."
      />
      <Card>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="pt-6">
            <FormSection title="Child" description="As written on the birth certificate.">
              <Field
                label="Full name"
                required
                error={errors.fullName?.message}
                className="sm:col-span-2"
              >
                <Input autoComplete="off" {...register('fullName')} />
              </Field>
              <Field label="Date of birth" required error={errors.dateOfBirth?.message}>
                <Controller
                  control={control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <DatePicker
                      value={field.value || undefined}
                      onChange={(v) => field.onChange(v ?? '')}
                      onBlur={field.onBlur}
                      withYearSelect
                      disabledDays={{ after: startOfToday() }}
                    />
                  )}
                />
              </Field>
              <Field label="Gender" required error={errors.gender?.message}>
                <Controller
                  control={control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger onBlur={field.onBlur}>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="female">Girl</SelectItem>
                        <SelectItem value="male">Boy</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </FormSection>
            <FormSection title="Guardian" description="Main contact for appointments and payments.">
              <Field label="Guardian name" required error={errors.guardianName?.message}>
                <Input autoComplete="name" {...register('guardianName')} />
              </Field>
              <Field label="Mobile number" required error={errors.guardianPhone?.message}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01712-345678"
                  {...register('guardianPhone')}
                />
              </Field>
              <Field
                label="Email"
                optional
                error={errors.guardianEmail?.message}
                className="sm:col-span-2"
              >
                <Input type="email" autoComplete="email" {...register('guardianEmail')} />
              </Field>
            </FormSection>
            <FormSection title="Therapy" description="Can be changed after the assessment.">
              <Field
                label="Therapy types"
                required
                error={errors.therapies?.message}
                className="sm:col-span-2"
              >
                <Controller
                  control={control}
                  name="therapies"
                  render={({ field }) => (
                    <MultiSelect
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="Select one or more"
                      options={[
                        { value: 'ot', label: 'Occupational therapy' },
                        { value: 'aba', label: 'Applied behaviour analysis' },
                        { value: 'slt', label: 'Speech & language therapy' },
                      ]}
                    />
                  )}
                />
              </Field>
            </FormSection>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => (isDirty ? setDiscardOpen(true) : reset(defaults))}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Save patient
            </Button>
          </CardFooter>
        </form>
      </Card>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="The information you entered will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          reset(defaults);
          setDiscardOpen(false);
        }}
      />
    </section>
  );
}
