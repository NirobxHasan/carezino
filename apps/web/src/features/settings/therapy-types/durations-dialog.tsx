'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Star, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Field } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { useAddDuration, useRemoveDuration, useUpdateDuration } from '@/lib/api/therapy-types';
import { showFormError } from '@/lib/forms';
import { LIMITS, formatMinutes } from '@/lib/settings-limits';
import type { CenterTherapyType, TherapyDurationOption } from '@/lib/types';

const { min, max } = LIMITS.durationMinutes;
const durationMessage = `Enter ${min}–${max} minutes`;

const addSchema = z.object({
  durationMinutes: z
    .number({ error: durationMessage })
    .int(durationMessage)
    .min(min, durationMessage)
    .max(max, durationMessage),
  label: z.string().trim().max(60),
});
type AddValues = z.input<typeof addSchema>;

function AddDurationForm({ type }: { type: CenterTherapyType }) {
  const add = useAddDuration();
  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { durationMinutes: undefined as unknown as number, label: '' },
  });
  const { register, handleSubmit, formState, reset, setError } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync({
        id: type.id,
        input: { durationMinutes: values.durationMinutes, label: values.label || undefined },
      });
      toast.success(`${formatMinutes(values.durationMinutes)} added`);
      reset();
    } catch (error) {
      showFormError(error, setError, ['durationMinutes', 'label']);
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-3 rounded-lg border border-dashed border-border-strong p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start"
    >
      <Field label="Minutes" error={errors.durationMinutes?.message}>
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={5}
          placeholder="60"
          className="tabular"
          {...register('durationMinutes', { valueAsNumber: true })}
        />
      </Field>
      <Field label="Label" optional error={errors.label?.message}>
        <Input placeholder="e.g. Extended session" {...register('label')} />
      </Field>
      <Button type="submit" variant="secondary" loading={isSubmitting} className="sm:mt-6">
        <Plus /> Add
      </Button>
    </form>
  );
}

function OptionRow({
  type,
  option,
  editable,
  onRemove,
}: {
  type: CenterTherapyType;
  option: TherapyDurationOption;
  editable: boolean;
  onRemove: (option: TherapyDurationOption) => void;
}) {
  const update = useUpdateDuration();
  const save = (input: Parameters<typeof update.mutate>[0]['input'], done: string) =>
    update.mutate(
      { id: type.id, durationId: option.id, input },
      { onSuccess: () => toast.success(done), onError: (e) => toast.error(e.message) },
    );
  const name = formatMinutes(option.durationMinutes);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={option.isActive ? 'font-medium tabular' : 'text-muted-foreground tabular'}>
          {name}
        </span>
        {option.label && (
          <span className="truncate text-[13px] text-muted-foreground">{option.label}</span>
        )}
        {option.isDefault && (
          <Badge tone="primary">
            <Star aria-hidden /> Default
          </Badge>
        )}
        {!option.isActive && <Badge>Off</Badge>}
      </div>
      {editable && (
        <div className="flex items-center gap-1">
          {!option.isDefault && option.isActive && (
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => save({ isDefault: true }, `${name} is now the default`)}
            >
              Make default
            </Button>
          )}
          <Switch
            checked={option.isActive}
            disabled={option.isDefault || update.isPending}
            onCheckedChange={(isActive) =>
              save({ isActive }, isActive ? `${name} turned on` : `${name} turned off`)
            }
            aria-label={`Offer ${name}`}
            title={option.isDefault ? 'The default duration is always offered' : undefined}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={option.isDefault}
            onClick={() => onRemove(option)}
            aria-label={`Remove ${name}`}
            title={option.isDefault ? 'Make another duration the default first' : undefined}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** The session lengths a therapy type can be booked for. Changes save as you make them. */
export function DurationsDialog({
  type,
  editable,
  onOpenChange,
}: {
  /** Kept current by the parent list, so changes show as soon as they're saved */
  type: CenterTherapyType | null;
  editable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useRemoveDuration();
  const [removing, setRemoving] = React.useState<TherapyDurationOption | null>(null);

  return (
    <Dialog open={Boolean(type)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {type && (
          <>
            <DialogHeader>
              <DialogTitle>Durations for {type.name}</DialogTitle>
              <DialogDescription>
                Session lengths staff can pick when booking. Existing bookings keep the length they
                were booked with.
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {type.durationOptions.map((option) => (
                <OptionRow
                  key={option.id}
                  type={type}
                  option={option}
                  editable={editable}
                  onRemove={setRemoving}
                />
              ))}
            </ul>
            {editable && <AddDurationForm key={type.id} type={type} />}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing ? formatMinutes(removing.durationMinutes) : ''}?`}
        description="It won’t be offered for new bookings. Bookings already made keep their length. To stop offering it for a while, switch it off instead."
        confirmLabel="Remove duration"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!type || !removing) return;
          remove.mutate(
            { id: type.id, durationId: removing.id },
            {
              onSuccess: () => {
                toast.success('Duration removed');
                setRemoving(null);
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      />
    </Dialog>
  );
}
