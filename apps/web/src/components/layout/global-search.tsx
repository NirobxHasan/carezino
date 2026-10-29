'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, CreditCard, Search, UserPlus } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { usePatientList } from '@/lib/api/patients';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import { formatPhone } from '@/lib/format';
import { navGroups, settingsNav } from './nav';

/** ⌘K / Ctrl+K: find a patient by name, ID or guardian phone, or jump to a page. */
export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debounced = useDebounced(query, 200);
  const router = useRouter();
  const { can } = useSession();
  const searching = debounced.trim().length > 1 && can('patients.read');
  const { data, isFetching } = usePatientList(
    { search: debounced, pageSize: 6, sortBy: 'fullName' },
    open && searching,
  );
  const patients = searching ? data?.items : undefined;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close if the route is hidden by Activity, so it doesn't reappear open.
  React.useLayoutEffect(() => () => setOpen(false), []);

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  const pages = [...navGroups.flatMap((g) => g.items), settingsNav].filter((i) =>
    can(i.permission),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-subtle-foreground shadow-xs transition-colors hover:border-border-strong focus-ring max-md:size-9 max-md:justify-center max-md:px-0 md:w-64"
        aria-label={can('patients.read') ? 'Search patients and pages' : 'Search pages'}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 text-left md:inline">
          {can('patients.read') ? 'Search patients…' : 'Search…'}
        </span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
          hideClose
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} loop>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={
                can('patients.read') ? 'Patient name, ID or guardian mobile…' : 'Go to a page…'
              }
            />
            <CommandList className="max-h-96">
              {searching && !isFetching && <CommandEmpty>No patients found.</CommandEmpty>}
              {searching && patients && patients.length > 0 && (
                <CommandGroup heading="Patients">
                  {patients.map((p) => (
                    <CommandItem key={p.id} value={p.id} onSelect={() => go(`/patients/${p.id}`)}>
                      <Avatar name={p.fullName} size="sm" />
                      <span className="flex-1 truncate">
                        {p.fullName}
                        <span className="ml-2 text-xs text-muted-foreground">{p.code}</span>
                      </span>
                      {p.primaryContact?.mobile && (
                        <span className="text-xs text-muted-foreground tabular">
                          {formatPhone(p.primaryContact.mobile)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!searching && (
                <>
                  <CommandGroup heading="Quick actions">
                    {can('patients.create') && (
                      <CommandItem value="register" onSelect={() => go('/patients/new')}>
                        <UserPlus /> Register patient
                      </CommandItem>
                    )}
                    {can('appointments.create') && (
                      <CommandItem value="book" onSelect={() => go('/appointments/new')}>
                        <CalendarPlus /> Book appointment
                      </CommandItem>
                    )}
                    {can('payments.collect') && (
                      <CommandItem value="pay" onSelect={() => go('/finance/dues')}>
                        <CreditCard /> Collect payment
                      </CommandItem>
                    )}
                  </CommandGroup>
                  <CommandGroup heading="Go to">
                    {pages.map((page) => (
                      <CommandItem key={page.href} value={page.href} onSelect={() => go(page.href)}>
                        <page.icon /> {page.title}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
