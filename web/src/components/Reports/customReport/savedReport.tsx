import { Link } from 'react-router-dom';
import type { CustomReport } from '../../../api/customReports';
import { useCustomReports } from './useCustomReports';

/** One saved report once the list arrived, or the placeholder to show instead. */
type SavedReportState =
  | { readonly report: CustomReport }
  | {
    readonly report?: never;
    readonly variant: 'loading' | 'error' | 'empty';
    readonly message: string;
  };

/** The saved report `id` (`GET /custom-reports`): loading, failed, deleted, or found. */
export function useSavedReport(id: string): SavedReportState {
  const {
    reports, loading, error
  } = useCustomReports();
  if (loading) return {
    variant: 'loading',
    message: 'Loading the report…',
  };
  if (error !== null) return {
    variant: 'error',
    message: error,
  };
  const report = reports.find((saved) => saved.id === id);
  if (report === undefined) return {
    variant: 'empty',
    message: 'This report no longer exists. It may have been deleted.',
  };
  return { report };
}

/** The way back from a custom report page that has nothing to show. */
export function BackToReportsLink() {
  return (
    <Link to="/reports" className="text-sm font-medium text-gray-700 underline hover:text-gray-900">
      Back to Reports
    </Link>
  );
}
