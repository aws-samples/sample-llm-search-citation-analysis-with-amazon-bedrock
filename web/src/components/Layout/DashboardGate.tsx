import type { ReactNode } from 'react';
import type { Stats } from '../../types';
import { Button } from '../ui/Button';
import { AppSkeleton } from './AppSkeleton';

interface DashboardGateProps {
  readonly loading: boolean;
  readonly stats: Stats | null;
  readonly error: string | null;
  readonly children: ReactNode;
}

/**
 * A skeleton until `/stats` answers (or every dashboard read settled), a
 * full-screen notice when the API is not configured, the app otherwise. A
 * failed panel read never blocks the app: it shows its own error and Retry.
 */
export function DashboardGate({
  loading, stats, error, children
}: DashboardGateProps) {
  if (loading && !stats) {
    return <AppSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div role="alert" className="max-w-md w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">The dashboard could not load</h1>
          <p className="mt-2 text-sm text-red-700 dark:text-red-400 break-words">{error}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
