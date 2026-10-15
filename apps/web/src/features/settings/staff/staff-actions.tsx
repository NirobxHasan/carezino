'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, CircleSlash, Clock, MailWarning } from 'lucide-react';
import { z } from 'zod';

import { StatusBadge } from '@/components/domain/status-badges';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Field } from '@/components/forms/field';
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
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/sonner';
import {
  useChangeRole,
  useChangeStatus,
  useInviteStaff,
  type InvitationResult,
} from '@/lib/api/staff';
import { showFormError } from '@/lib/forms';
import { ROLES, roleDescriptions, roleLabels } from '@/lib/permissions';
import type { MembershipStatus, Role, StaffInvitation, StaffMember } from '@/lib/types';
import { optionalBdPhone, requiredText } from '@/lib/validation';

export function StaffStatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <StatusBadge
      def={
        status === 'ACTIVE'
          ? { label: 'Active', tone: 'success', icon: CheckCircle2 }
          : { label: 'Inactive', tone: 'neutral', icon: CircleSlash }
      }
    />
  );
}

export function InvitationStatusBadge({ invitation }: { invitation: StaffInvitation }) {
  return (
    <StatusBadge
      def={
        invitation.expired
          ? { label: 'Expired', tone: 'danger', icon: Clock }
          : { label: 'Invited', tone: 'info', icon: Clock }
      }
    />
  );
}

/** Tells the admin honestly whether the invitation email went out. */
export function announceInvitation(result: InvitationResult, verb: 'sent' | 'resent') {
  if (result.emailDelivered) {
    toast.success(`Invitation ${verb} to ${result.invitation.email}`);
  } else {
    toast.warning('Invitation saved, but no email was sent', {
      description:
        'Email delivery isn’t set up for Carezino yet, or it failed. Once it’s working, use Resend from the Invitations tab.',
      icon: <MailWarning className="size-4" />,
      duration: 10_000,
    });
  }
}

function RolePicker({
  value,
  onChange,
}: {
  value: Role | undefined;
  onChange: (role: Role) => void;
}) {
  return (
    <RadioGroup
      value={value ?? ''}
      onValueChange={(v) => onChange(v as Role)}
      className="grid gap-2 sm:grid-cols-2"
      aria-label="Role"
    >
      {ROLES.map((role) => (
        <RadioCard
          key={role}
          value={role}
          title={roleLabels[role]}
          description={roleDescriptions[role]}
        />
      ))}
    </RadioGroup>
  );
}

const inviteSchema = z.object({
  fullName: requiredText('Full name').max(120),
  email: z.email('Enter a valid email address'),
  mobile: optionalBdPhone,
  role: z.enum(['CENTER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'THERAPIST'], {
    error: 'Choose a role',
  }),
});

type InviteValues = z.input<typeof inviteSchema>;
const inviteDefaults = {
  fullName: '',
  email: '',
  mobile: '',
  role: undefined as unknown as Role,
} satisfies InviteValues;

export function InviteStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invite = useInviteStaff();
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: inviteDefaults,
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const { errors, isSubmitting } = formState;

  React.useEffect(() => {
    if (!open) reset(inviteDefaults);
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await invite.mutateAsync({ ...values, mobile: values.mobile || undefined });
      announceInvitation(result, 'sent');
      onOpenChange(false);
    } catch (error) {
      showFormError(error, setError, ['fullName', 'email', 'mobile', 'role']);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite a staff member</DialogTitle>
          <DialogDescription>
            They’ll get an email with a link to join your center and set their own password. The
            link works for 7 days.
          </DialogDescription>
        </DialogHeader>
        <form
          id="invite-staff"
          onSubmit={onSubmit}
          noValidate
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field
            label="Full name"
            required
            error={errors.fullName?.message}
            className="sm:col-span-2"
          >
            <Input autoComplete="off" {...register('fullName')} />
          </Field>
          <Field label="Email" required error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...register('email')} />
          </Field>
          <Field label="Mobile number" optional error={errors.mobile?.message}>
            <Input type="tel" inputMode="tel" placeholder="01712-345678" {...register('mobile')} />
          </Field>
          <Field label="Role" required error={errors.role?.message} className="sm:col-span-2">
            <Controller
              control={control}
              name="role"
              render={({ field }) => <RolePicker value={field.value} onChange={field.onChange} />}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="invite-staff" loading={isSubmitting}>
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChangeRoleDialog({
  member,
  onOpenChange,
}: {
  member: StaffMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const changeRole = useChangeRole();
  // Rendered with key={member.id}, so this starts from each member's current role.
  const [role, setRole] = React.useState<Role | undefined>(member?.role);

  const save = () => {
    if (!member || !role) return;
    changeRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => {
          toast.success(`${member.fullName} is now ${roleLabels[role].toLowerCase()}`);
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            {member?.fullName}’s access at this center changes immediately. Their role at other
            centers isn’t affected.
          </DialogDescription>
        </DialogHeader>
        <RolePicker value={role} onChange={setRole} />
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={changeRole.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            loading={changeRole.isPending}
            disabled={!role || role === member?.role}
          >
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChangeStatusDialog({
  member,
  onOpenChange,
}: {
  member: StaffMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const changeStatus = useChangeStatus();
  const deactivating = member?.status === 'ACTIVE';

  return (
    <ConfirmDialog
      open={Boolean(member)}
      onOpenChange={onOpenChange}
      title={deactivating ? `Deactivate ${member?.fullName}?` : `Reactivate ${member?.fullName}?`}
      description={
        deactivating
          ? 'They’ll lose access to this center right away. Their records and history are kept, and you can reactivate them later.'
          : 'They’ll be able to sign in to this center again with their current role.'
      }
      confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
      tone={deactivating ? 'danger' : 'primary'}
      loading={changeStatus.isPending}
      onConfirm={() => {
        if (!member) return;
        changeStatus.mutate(
          { id: member.id, status: deactivating ? 'INACTIVE' : 'ACTIVE' },
          {
            onSuccess: () => {
              toast.success(
                deactivating
                  ? `${member.fullName} was deactivated`
                  : `${member.fullName} was reactivated`,
              );
              onOpenChange(false);
            },
            onError: (error) => toast.error(error.message),
          },
        );
      }}
    />
  );
}

/** State for the role and status dialogs, shared by the staff list and the detail page. */
export function useStaffDialogs() {
  const [roleTarget, setRoleTarget] = React.useState<StaffMember | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<StaffMember | null>(null);
  const dialogs = (
    <>
      <ChangeRoleDialog
        key={roleTarget?.id ?? 'none'}
        member={roleTarget}
        onOpenChange={(o) => !o && setRoleTarget(null)}
      />
      <ChangeStatusDialog member={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} />
    </>
  );
  return { changeRole: setRoleTarget, changeStatus: setStatusTarget, dialogs };
}
