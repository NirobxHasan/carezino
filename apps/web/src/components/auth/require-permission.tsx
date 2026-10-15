'use client';

import * as React from 'react';
import { ShieldAlert } from 'lucide-react';

import { EmptyState } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import type { Permission } from '@/lib/permissions';
import { useSession } from '@/lib/session';

/**
 * Hides a screen from users whose role lacks the permission. Presentation only: the API
 * refuses the underlying requests regardless.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can } = useSession();
  if (can(permission)) return <>{children}</>;
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title="You don’t have access to this page"
        description="Ask a center administrator if you need it."
      />
    </Card>
  );
}
