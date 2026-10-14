'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <ErrorState
        title="This page couldn’t be loaded"
        message="An unexpected error occurred. Try again, or come back in a moment."
        onRetry={retry}
      />
    </Card>
  );
}
