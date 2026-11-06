import type { ReactNode } from 'react';
import type { Stats } from '../../types';
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
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-red-600 dark:text-red-400">Error: {error}</div>
      </div>
    );
  }

  return <>{children}</>;
}
