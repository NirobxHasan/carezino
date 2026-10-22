'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useLocalState } from '@/lib/hooks/use-local-state';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { cn } from '@/lib/utils';
import {
  CenterBadge,
  ExpandButton,
  SidebarHeader,
  SidebarNav,
  SidebarNavFallback,
} from './app-sidebar';
import { BreadcrumbProvider, Breadcrumbs } from './breadcrumbs';
import { GlobalSearch } from './global-search';
import { NotificationsMenu } from './notifications-menu';
import { UserMenu } from './user-menu';

/**
 * Responsive dashboard frame.
 * - < 768px: sidebar becomes a drawer opened from the topbar.
 * - 768–1023px: icon rail.
 * - ≥ 1024px: full sidebar, collapsible to the rail (remembered per browser).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsedPref, setCollapsedPref] = useLocalState<boolean>(
    'carezino.sidebar-collapsed',
    false,
  );
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const railOnly = !isDesktop;
  const collapsed = railOnly || collapsedPref;
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <BreadcrumbProvider>
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <aside
          data-collapsed={collapsedPref}
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 md:flex print:hidden',
            'md:w-(--sidebar-width-collapsed) lg:w-(--sidebar-width) lg:data-[collapsed=true]:w-(--sidebar-width-collapsed)',
          )}
        >
          <SidebarHeader
            collapsed={collapsed}
            onToggle={isDesktop ? () => setCollapsedPref(true) : undefined}
          />
          <React.Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav collapsed={collapsed} />
            <CenterBadge collapsed={collapsed} />
          </React.Suspense>
          {isDesktop && collapsedPref && <ExpandButton onToggle={() => setCollapsedPref(false)} />}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-(--topbar-height) print:hidden shrink-0 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-9 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </Button>
            <React.Suspense fallback={<div className="h-5 w-32 rounded bg-muted" />}>
              <Breadcrumbs className="flex-1" />
            </React.Suspense>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <React.Suspense fallback={null}>
                <GlobalSearch />
                <NotificationsMenu />
              </React.Suspense>
              <UserMenu />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            <div className="mx-auto w-full max-w-(--content-max-width) px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
              {children}
            </div>
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] bg-sidebar p-0" hideClose>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarHeader collapsed={false} />
          <React.Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <CenterBadge collapsed={false} />
          </React.Suspense>
        </SheetContent>
      </Sheet>
    </BreadcrumbProvider>
  );
}
