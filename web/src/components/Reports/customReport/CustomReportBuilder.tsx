import {
  Link, useParams
} from 'react-router-dom';
import { SectionPlaceholder } from '../layout';
import { ReportDraftEditor } from './builder/ReportDraftEditor';
import { useCustomReports } from './useCustomReports';

function EditableReport({ id }: { readonly id: string }) {
  const {
    reports, loading, error
  } = useCustomReports();
  if (loading) return <SectionPlaceholder variant="loading" message="Loading the report…" />;
  if (error !== null) return <SectionPlaceholder variant="error" message={error} />;
  const saved = reports.find((report) => report.id === id);
  if (saved === undefined) {
    return (
      <div className="space-y-3">
        <SectionPlaceholder variant="empty" message="This report no longer exists. It may have been deleted." />
        <Link to="/reports" className="text-sm font-medium text-gray-700 underline hover:text-gray-900">Back to Reports</Link>
      </div>
    );
  }
  return <ReportDraftEditor key={saved.id} saved={saved} />;
}

/**
 * The report builder: `/reports/custom/new` starts an empty report,
 * `/reports/custom/:id/edit` opens a saved one.
 */
export function CustomReportBuilder() {
  const { id } = useParams<{ id: string }>();
  return id === undefined ? <ReportDraftEditor saved={null} /> : <EditableReport id={id} />;
}
