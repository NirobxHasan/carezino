'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight } from 'lucide-react';

import { AuthCard, FormAlert } from '@/components/auth/auth-card';
import { InlineLoader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useLogout, useMe, useSwitchCenter } from '@/lib/api/auth';
import { roleLabels } from '@/lib/permissions';

/** Shown after sign-in when the user works at several centers and hasn't picked one. */
export function SelectCenter() {
  const router = useRouter();
  const me = useMe();
  const switchCenter = useSwitchCenter();
  const logout = useLogout();
  const [choosing, setChoosing] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (me.isSuccess && !me.data) router.replace('/login?next=/select-center');
    else if (me.data?.user.isPlatformAdmin && !me.data.centers.length) router.replace('/admin');
  }, [me.isSuccess, me.data, router]);

  if (me.isPending || !me.data) return <InlineLoader />;
  const { centers, activeCenter, user } = me.data;

  const signOut = () => logout.mutate(undefined, { onSettled: () => router.replace('/login') });

  if (!centers.length) {
    return (
      <AuthCard title="No center access" description={`Signed in as ${user.email}`}>
        <FormAlert>
          Your account isn’t active at any center right now. Ask your center administrator to invite
          you or reactivate your access.
        </FormAlert>
        <Button
          variant="secondary"
          size="lg"
          className="mt-5 w-full"
          onClick={signOut}
          loading={logout.isPending}
        >
          Sign out
        </Button>
      </AuthCard>
    );
  }

  const choose = (centerId: string) => {
    setChoosing(centerId);
    switchCenter.mutate(centerId, {
      onSuccess: () => router.replace('/dashboard'),
      onError: (error) => {
        setChoosing(null);
        toast.error(error.message);
      },
    });
  };

  return (
    <AuthCard
      title="Choose a center"
      description="You work at more than one center. Pick where to start; you can switch any time from your profile menu."
    >
      <ul className="grid gap-2">
        {centers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => choose(c.id)}
              disabled={switchCenter.isPending}
              aria-current={activeCenter?.id === c.id || undefined}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-accent focus-ring disabled:opacity-60"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary">
                <Building2 className="size-4" aria-hidden />
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {roleLabels[c.role]} · {c.code}
                </span>
              </span>
              {choosing === c.id ? (
                <span className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="mt-4 w-full" onClick={signOut} loading={logout.isPending}>
        Sign out
      </Button>
    </AuthCard>
  );
}
