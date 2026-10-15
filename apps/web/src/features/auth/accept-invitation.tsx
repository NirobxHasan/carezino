'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { InlineLoader } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { authApi, useAcceptInvitation, useLogout, useMe } from '@/lib/api/auth';
import { showFormError } from '@/lib/forms';
import { roleLabels } from '@/lib/permissions';
import type { InvitationPreview } from '@/lib/types';
import { newPassword, optionalBdPhone, requiredText } from '@/lib/validation';

const schema = z
  .object({
    fullName: requiredText('Full name').max(120),
    mobile: optionalBdPhone,
    password: newPassword,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });

type Values = z.input<typeof schema>;

function Summary({ invitation }: { invitation: InvitationPreview }) {
  return (
    <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-muted/60 px-4 py-3 text-sm">
      <dt className="text-muted-foreground">Center</dt>
      <dd className="font-medium">{invitation.centerName}</dd>
      <dt className="text-muted-foreground">Role</dt>
      <dd>{roleLabels[invitation.role]}</dd>
      <dt className="text-muted-foreground">Email</dt>
      <dd className="truncate">{invitation.email}</dd>
    </dl>
  );
}

function NewAccountForm({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const router = useRouter();
  const accept = useAcceptInvitation();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: invitation.fullName,
      mobile: invitation.mobile ?? '',
      password: '',
      confirmPassword: '',
    },
    mode: 'onTouched',
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await accept.mutateAsync({ token, ...values, mobile: values.mobile || undefined });
      toast.success(`Welcome to ${invitation.centerName}`);
      router.replace('/dashboard');
    } catch (error) {
      showFormError(error, form.setError, ['fullName', 'mobile', 'password', 'confirmPassword']);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field label="Full name" required error={errors.fullName?.message}>
        <Input autoComplete="name" {...form.register('fullName')} />
      </Field>
      <Field label="Mobile number" optional error={errors.mobile?.message}>
        <Input type="tel" inputMode="tel" autoComplete="tel" {...form.register('mobile')} />
      </Field>
      <Field
        label="Choose a password"
        required
        error={errors.password?.message}
        helper="At least 8 characters."
      >
        <PasswordInput autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Field label="Confirm password" required error={errors.confirmPassword?.message}>
        <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
        Accept and create account
      </Button>
    </form>
  );
}

function ExistingAccount({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const router = useRouter();
  const me = useMe();
  const accept = useAcceptInvitation();
  const logout = useLogout();
  const here = `/invite?token=${encodeURIComponent(token)}`;

  if (me.isPending) return <InlineLoader />;
  const signedInAs = me.data?.user.email;

  if (!signedInAs) {
    return (
      <>
        <p className="mb-4 text-sm text-muted-foreground">
          You already have a Carezino account. Sign in as {invitation.email} to accept.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href={`/login?next=${encodeURIComponent(here)}`}>Sign in to accept</Link>
        </Button>
      </>
    );
  }

  if (signedInAs !== invitation.email) {
    return (
      <>
        <FormAlert>
          You’re signed in as {signedInAs}, but this invitation is for {invitation.email}.
        </FormAlert>
        <Button
          variant="secondary"
          size="lg"
          className="mt-4 w-full"
          loading={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => void me.refetch() })}
        >
          Sign out and continue
        </Button>
      </>
    );
  }

  return (
    <Button
      size="lg"
      className="w-full"
      loading={accept.isPending}
      onClick={() =>
        accept.mutate(
          { token },
          {
            onSuccess: () => {
              toast.success(`You’ve joined ${invitation.centerName}`);
              router.replace('/dashboard');
            },
            onError: (error) => toast.error(error.message),
          },
        )
      }
    >
      Accept invitation
    </Button>
  );
}

export function AcceptInvitation() {
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => authApi.previewInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });

  const back = (
    <Link href="/login" className="rounded font-medium text-primary hover:underline focus-ring">
      Go to sign in
    </Link>
  );

  if (token && preview.isPending) return <InlineLoader label="Checking your invitation…" />;
  if (!token || preview.isError || !preview.data?.valid) {
    const message =
      preview.data?.valid === false
        ? preview.data.message
        : (preview.error?.message ??
          'This page needs the link from your invitation email. Ask your center administrator to send it again.');
    return (
      <AuthCard title="Invitation not available" footer={back}>
        <FormAlert>{message}</FormAlert>
      </AuthCard>
    );
  }

  const invitation = preview.data;
  return (
    <AuthCard
      title={`Join ${invitation.centerName}`}
      description="You’ve been invited to work with this center on Carezino."
    >
      <Summary invitation={invitation} />
      {invitation.accountExists ? (
        <ExistingAccount token={token} invitation={invitation} />
      ) : (
        <NewAccountForm token={token} invitation={invitation} />
      )}
    </AuthCard>
  );
}
