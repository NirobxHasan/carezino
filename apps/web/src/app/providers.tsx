'use client';

import { useState } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { isApiError } from '@/lib/api/client';
import { keys } from '@/lib/api/keys';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    // A 401 from any request means the session ended (expired, revoked or signed out
    // elsewhere). Clearing the user lets AuthGate send them to sign in.
    const onError = (error: unknown) => {
      if (isApiError(error, 401) && client.getQueryData(keys.me)) {
        client.setQueryData(keys.me, null);
      }
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          // Retrying won't fix a 4xx (no session, no permission, not found).
          retry: (count, error) =>
            !(isApiError(error) && error.status >= 400 && error.status < 500) && count < 1,
        },
        mutations: { retry: 0 },
      },
    });
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
