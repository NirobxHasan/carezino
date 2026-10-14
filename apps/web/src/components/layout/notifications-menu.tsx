'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkNotificationsRead, useNotifications } from '@/lib/api/dashboard';
import { formatAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export function NotificationsMenu() {
  const [open, setOpen] = React.useState(false);
  const { data = [] } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = data.filter((n) => !n.read).length;

  React.useLayoutEffect(() => () => setOpen(false), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-[18px] text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute top-2 right-2 size-2 rounded-full bg-danger ring-2 ring-surface" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto text-xs"
              onClick={() => markRead.mutate()}
            >
              Mark all as read
            </Button>
          )}
        </div>
        {data.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            You’re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {data.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href ?? '#'}
                  onNavigate={() => setOpen(false)}
                  className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/60 focus-ring"
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-primary',
                    )}
                    aria-hidden
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">
                      {n.title}
                      {!n.read && <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="text-[13px] text-muted-foreground">{n.body}</span>
                    <span className="text-xs text-subtle-foreground">{formatAgo(n.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
