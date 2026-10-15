'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { Field } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getMe, useLogin, useRegistrationStatus } from '@/lib/api/auth';
import { keys } from '@/lib/api/keys';
import { safeNext } from '@/lib/auth/constants';
import { redirectFor } from '@/lib/auth/session-api';

const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean(),
});

type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const login = useLogin();
  const queryClient = useQueryClient();
  const registration = useRegistrationStatus();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: false },
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, resetField } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      // Go straight to where this user belongs (super admin area, center picker, or the
      // requested page) instead of bouncing through a redirect.
      const me = await queryClient.fetchQuery({ queryKey: keys.me, queryFn: getMe });
      router.replace((me && redirectFor(me, next)) ?? next);
    } catch (error) {
      // The API's messages are user-facing and deliberately generic for bad credentials.
      setFormError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
      resetField('password');
    }
  });

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to manage your therapy center."
      footer={
        registration.data?.enabled ? (
          <>
            New to Carezino?{' '}
            <Link
              href="/register"
              className="font-medium text-primary hover:underline focus-ring rounded"
            >
              Register your center
            </Link>
          </>
        ) : null
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...register('email')} />
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          labelAction={
            <Link
              href="/forgot-password"
              className="rounded text-[13px] font-medium text-primary hover:underline focus-ring"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="flex items-center gap-2">
          <Controller
            control={control}
            name="remember"
            render={({ field }) => (
              <Checkbox
                id="remember"
                checked={field.value}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
            )}
          />
          <Label htmlFor="remember" className="font-normal">
            Keep me signed in on this device for 30 days
          </Label>
        </div>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
