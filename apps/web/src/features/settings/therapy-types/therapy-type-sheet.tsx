'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ColorPicker } from '@/components/forms/color-picker';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCreateTherapyType, useUpdateTherapyType } from '@/lib/api/therapy-types';
import { showFormError } from '@/lib/forms';
import { LIMITS } from '@/lib/settings-limits';
import type { CenterTherapyType } from '@/lib/types';
import { requiredText } from '@/lib/validation';

const { min, max } = LIMITS.durationMinutes;
const durationMessage = `Enter a duration between ${min} and ${max} minutes`;

const schema = z.object({
  name: requiredText('Name').max(100),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(
      z
        .string()
        .min(1, 'Short code is required')
        .regex(/^[A-Z0-9][A-Z0-9-]{0,9}$/, 'Use up to 10 letters, numbers or dashes, e.g. OT'),
    ),
  description: z.string().trim().max(500),
  defaultDurationMinutes: z
    .number({ error: durationMessage })
    .int(durationMessage)
    .min(min, durationMessage)
    .max(max, durationMessage),
  color: z.string(),
  isActive: z.boolean(),
});

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape);

const emptyValues: Values = {
  name: '',
  code: '',
  description: '',
  defaultDurationMinutes: 45,
  color: '',
  isActive: true,
};

function toValues(t: CenterTherapyType): Values {
  return {
    name: t.name,
    code: t.code,
    description: t.description ?? '',
    defaultDurationMinutes: t.defaultDurationMinutes,
    color: t.color ?? '',
    isActive: t.isActive,
  };
}

/** Drawer to add a therapy type, or edit one when `type` is given. */
export function TherapyTypeSheet({
  open,
  onOpenChange,
  type,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type?: CenterTherapyType | null;
  onCreated?: (type: CenterTherapyType) => void;
}) {
  const create = useCreateTherapyType();
  const update = useUpdateTherapyType();
  const editing = Boolean(type);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const { errors, isSubmitting, isDirty, dirtyFields } = formState;

  React.useEffect(() => {
    if (open) reset(type ? toValues(type) : emptyValues);
  }, [open, type, reset]);

  const onSubmit = handleSubmit(async (raw) => {
    const values = schema.parse(raw);
    try {
      if (type) {
        // Only what changed; empty description or colour clears it.
        const changed = Object.fromEntries(
          Object.entries(values).filter(([key]) => dirtyFields[key as keyof Values]),
        );
        await update.mutateAsync({ id: type.id, input: changed });
        toast.success(`${values.name} saved`);
      } else {
        const created = await create.mutateAsync({
          ...values,
          description: values.description || undefined,
          color: values.color || undefined,
        });
        toast.success(`${created.name} added`);
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (error) {
      showFormError(error, setError, FIELDS);
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? `Edit ${type?.name}` : 'Add therapy type'}</SheetTitle>
            <SheetDescription>
              {editing
                ? 'Changes apply to new bookings. Past records keep their details.'
                : 'A service your center offers, such as Physiotherapy.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-4">
            <Field label="Name" required error={errors.name?.message}>
              <Input placeholder="Occupational Therapy" {...register('name')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Short code"
                required
                error={errors.code?.message}
                helper="Shown on calendars, e.g. OT"
              >
                <Input className="uppercase" autoComplete="off" {...register('code')} />
              </Field>
              <Field
                label="Default duration"
                required
                error={errors.defaultDurationMinutes?.message}
                helper="Minutes"
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  step={5}
                  className="tabular"
                  {...register('defaultDurationMinutes', { valueAsNumber: true })}
                />
              </Field>
            </div>
            <Field label="Description" optional error={errors.description?.message}>
              <Textarea rows={3} {...register('description')} />
            </Field>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <Field
                  label="Colour"
                  optional
                  error={errors.color?.message}
                  helper="Helps tell services apart on the calendar."
                >
                  <ColorPicker value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">Active</span>
                    <span className="text-xs text-muted-foreground">
                      Inactive types can’t be chosen for new bookings, but stay on past records.
                    </span>
                  </span>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
            {editing && (
              <p className="text-xs text-muted-foreground">
                To offer more than one session length, use <strong>Manage durations</strong> from
                the list.
              </p>
            )}
          </SheetBody>
          <SheetFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={editing && !isDirty}>
              {editing ? 'Save changes' : 'Add therapy type'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
