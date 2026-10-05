import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { EmptyState, PageHeader } from '@/components/screen-parts';
import { Button } from '@/components/ui/button';

/**
 * The catch-all screen.
 *
 * It names the path that was not found, because a bare "404" tells a user on a
 * phone nothing about whether they mistyped a link or reached a screen that does
 * not exist. The path is echoed from the router, so it is exactly what they asked
 * for.
 */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="space-y-4">
      <PageHeader title="Not found" />
      <EmptyState
        title="There is nothing at that address"
        description={location.pathname}
        action={
          <Button render={<Link to="/" />}>
            <Compass aria-hidden data-icon="inline-start" />
            Back to the dashboard
          </Button>
        }
      />
    </div>
  );
}
