import Link from 'next/link';
import { Palette, type LucideIcon } from 'lucide-react';

import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from './page-header';

/**
 * Stand-in for a module whose screens haven't been built yet. Keeps navigation working
 * inside the app shell while module requirements are being finalised.
 */
export function ModulePlaceholder({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="animate-in">
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState
          icon={icon}
          title="This module is being designed"
          description="The layout, navigation and shared components are ready. Screens for this module will be added once its requirements are finalised."
          action={
            <Button variant="secondary" asChild>
              <Link href="/design-system">
                <Palette /> Browse the design system
              </Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
