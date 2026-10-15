'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { z } from 'zod';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { Field } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { safeNext } from '@/lib/auth/constants';
import { useAdminLogin } from '@/lib/api/platform';

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});

type Values = z.infer<typeof schema>;

/** Sign-in for Carezino platform administrators (super admins). */
export function AdminLoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'), '/admin');
  const login = useAdminLogin();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
    mode: 'onTouched',
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      router.replace(next.startsWith('/admin') ? next : '/admin');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.');
      form.resetField('password');
    }
  });

  return (
    <AuthCard
      title="Platform administration"
      description="Sign in to manage the therapy centers on Carezino."
      footer={
        <Link href="/login" className="rounded font-medium text-primary hover:underline focus-ring">
          Center staff sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-primary-subtle px-3 py-2 text-[13px] text-primary-subtle-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          Restricted to Carezino platform administrators.
        </div>
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label="Username" error={errors.username?.message}>
          <Input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            {...form.register('username')}
          />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
