'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Field, FormSection } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { useChangePassword, useUpdateProfile } from '@/lib/api/auth';
import { showFormError } from '@/lib/forms';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { newPassword, optionalBdPhone, requiredText } from '@/lib/validation';

const profileSchema = z.object({
  fullName: requiredText('Full name').max(120),
  mobile: optionalBdPhone,
});
type ProfileValues = z.input<typeof profileSchema>;

function ProfileForm() {
  const { me, activeCenter } = useSession();
  const update = useUpdateProfile();
  const defaults = { fullName: me.user.fullName, mobile: me.user.mobile ?? '' };
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
    mode: 'onTouched',
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  useUnsavedChanges(isDirty);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      form.reset({ fullName: saved.user.fullName, mobile: saved.user.mobile ?? '' });
      toast.success('Profile saved');
    } catch (error) {
      showFormError(error, form.setError, ['fullName', 'mobile']);
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="pt-6">
          <FormSection
            title="Your details"
            description="Shown to your team at every center you work with."
          >
            <Field
              label="Full name"
              required
              error={errors.fullName?.message}
              className="sm:col-span-2"
            >
              <Input autoComplete="name" {...form.register('fullName')} />
            </Field>
            <Field label="Email" helper="You sign in with this. Changing it isn’t available yet.">
              <Input value={me.user.email} readOnly disabled />
            </Field>
            <Field label="Mobile number" optional error={errors.mobile?.message}>
              <Input type="tel" inputMode="tel" autoComplete="tel" {...form.register('mobile')} />
            </Field>
            <Field
              label={`Role at ${activeCenter.name}`}
              helper="Set by your center administrator."
            >
              <Input value={roleLabels[activeCenter.role]} readOnly disabled />
            </Field>
          </FormSection>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={!isDirty || isSubmitting}
            onClick={() => form.reset(defaults)}
          >
            Discard changes
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password: newPassword,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });
type PasswordValues = z.infer<typeof passwordSchema>;
const emptyPasswords = { currentPassword: '', password: '', confirmPassword: '' };

export function ChangePasswordForm() {
  const change = useChangePassword();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: emptyPasswords,
    mode: 'onTouched',
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await change.mutateAsync(values);
      form.reset(emptyPasswords);
      toast.success('Password changed', {
        description: 'You’ve been signed out on your other devices.',
      });
    } catch (error) {
      showFormError(error, form.setError, ['currentPassword', 'password', 'confirmPassword']);
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="pt-6">
          <FormSection
            title="Password"
            description="Changing it signs you out everywhere except this browser."
          >
            <Field
              label="Current password"
              required
              error={errors.currentPassword?.message}
              className="sm:col-span-2"
            >
              <PasswordInput
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </Field>
            <Field
              label="New password"
              required
              error={errors.password?.message}
              helper="At least 8 characters."
            >
              <PasswordInput autoComplete="new-password" {...form.register('password')} />
            </Field>
            <Field label="Confirm new password" required error={errors.confirmPassword?.message}>
              <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
            </Field>
          </FormSection>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" loading={isSubmitting}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ProfileScreen() {
  return (
    <div className="animate-in space-y-6">
      <PageHeader title="My profile" description="Your account details and password." />
      <ProfileForm />
      <ChangePasswordForm />
    </div>
  );
}
