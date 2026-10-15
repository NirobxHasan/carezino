'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { Field } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api/auth';
import { showFormError } from '@/lib/forms';
import { newPassword, withPasswordConfirmation } from '@/lib/validation';

const backToSignIn = (
  <Link href="/login" className="rounded font-medium text-primary hover:underline focus-ring">
    Back to sign in
  </Link>
);

const forgotSchema = z.object({ email: z.email('Enter a valid email address') });

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const forgot = useMutation({ mutationFn: authApi.forgotPassword });
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await forgot.mutateAsync(email);
      setSentTo(email);
    } catch (error) {
      showFormError(error, form.setError, ['email']);
    }
  });

  if (sentTo) {
    return (
      <AuthCard title="Check your email" footer={backToSignIn}>
        <FormAlert tone="success">
          If <strong className="font-medium">{sentTo}</strong> has a Carezino account, we’ve sent a
          link to reset the password. It works once and expires in 30 minutes.
        </FormAlert>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Nothing arrived? Check spam, or ask your center administrator to confirm the email on your
          account.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you sign in with and we’ll send you a reset link."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

const resetSchema = withPasswordConfirmation(
  z.object({ password: newPassword, confirmPassword: z.string().min(1, 'Confirm your password') }),
);

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = React.useState(false);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const reset = useMutation({ mutationFn: authApi.resetPassword });
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onTouched',
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setLinkError(null);
    try {
      await reset.mutateAsync({ ...values, token });
      setDone(true);
    } catch (error) {
      if (!showFormError(error, form.setError, ['password', 'confirmPassword'], { toast: false })) {
        setLinkError(error instanceof Error ? error.message : 'Something went wrong.');
      }
    }
  });

  if (!token) {
    return (
      <AuthCard title="Reset link missing" footer={backToSignIn}>
        <FormAlert>
          This page needs the link from your reset email.{' '}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
          .
        </FormAlert>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <FormAlert tone="success">
          Your password has been reset and you’ve been signed out on every device.
        </FormAlert>
        <Button asChild size="lg" className="mt-5 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Use at least 8 characters."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {linkError && (
          <FormAlert>
            {linkError}{' '}
            <Link href="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </FormAlert>
        )}
        <Field label="New password" error={errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <Field label="Confirm new password" error={errors.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Reset password
        </Button>
      </form>
    </AuthCard>
  );
}
