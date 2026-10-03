import {
  Link, useNavigate
} from 'react-router-dom';
import type { CustomReport } from '../../../api/customReports';
import { formatDateOnly } from '../../../formatting/dateFormatter';
import {
  Button, PencilIcon, PlusIcon
} from '../../ui';
import { SectionPlaceholder } from '../layout';
import {
  customReportEditPath, customReportPath, NEW_CUSTOM_REPORT_PATH
} from './customReportRoute';
import { useCustomReports } from './useCustomReports';

function blockCount(report: CustomReport): string {
  return report.blocks.length === 1 ? '1 block' : `${report.blocks.length} blocks`;
}

function SavedReportRow({ report }: { readonly report: CustomReport }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link to={customReportPath(report.id)} className="text-sm font-medium text-gray-900 hover:underline">
          {report.title}
        </Link>
        <p className="text-xs text-gray-500">
          {`${blockCount(report)} · last ${report.days} days · updated ${formatDateOnly(report.updated_at)} by ${report.updated_by}`}
        </p>
      </div>
      <Link
        to={customReportEditPath(report.id)}
        aria-label={`Edit ${report.title}`}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <PencilIcon className="h-4 w-4" />
        Edit
      </Link>
    </li>
  );
}

function SavedReports() {
  const {
    reports, loading, error
  } = useCustomReports();
  if (loading) return <SectionPlaceholder variant="loading" message="Loading your reports…" />;
  if (error !== null) return <SectionPlaceholder variant="error" message={error} />;
  if (reports.length === 0) {
    return <p className="mt-3 text-sm text-gray-500">No custom report yet. Create one from the sections of every report below.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-gray-200">
      {reports.map((report) => <SavedReportRow key={report.id} report={report} />)}
    </ul>
  );
}

/**
 * The custom reports on the Reports page: every saved one, newest change
 * first, and the way to build a new one.
 */
export function CustomReportsPanel() {
  const navigate = useNavigate();
  return (
    <section aria-labelledby="custom-reports-heading" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="custom-reports-heading" className="text-base font-semibold text-gray-900">Custom reports</h3>
          <p className="mt-1 text-sm text-gray-500">
            Your own report: pick the sections you need from every report, add headings, text, images or videos, and put them in order.
          </p>
        </div>
        <Button leadingIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate(NEW_CUSTOM_REPORT_PATH)}>
          Create custom report
        </Button>
      </div>
      <SavedReports />
    </section>
  );
}
