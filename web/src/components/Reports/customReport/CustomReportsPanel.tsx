import { useState } from 'react';
import {
  Link, useNavigate
} from 'react-router-dom';
import {
  deleteCustomReport, type CustomReport
} from '../../../api/customReports';
import { formatDateOnly } from '../../../formatting/dateFormatter';
import { getErrorMessage } from '../../../infrastructure';
import { ActionMenu } from '../../ui/ActionMenu';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SectionPlaceholder } from '../layout';
import {
  Skeleton, SkeletonRegion
} from '../../ui/Skeleton';
import {
  customReportEditPath, customReportPath
} from './customReportRoute';
import { DeleteReportModal } from './DeleteReportModal';
import { useCustomReports } from './useCustomReports';

function blockCount(report: CustomReport): string {
  return report.blocks.length === 1 ? '1 block' : `${report.blocks.length} blocks`;
}

interface RowProps {
  readonly report: CustomReport;
  readonly onDelete: (report: CustomReport) => void;
}

/** A saved report: its name (the link that opens it), what it holds, and its Open / Edit / Delete menu. */
function SavedReportRow({
  report, onDelete
}: RowProps) {
  const navigate = useNavigate();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <Link
          to={customReportPath(report.id)}
          className="break-words rounded text-sm font-medium text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:text-white"
        >
          {report.title}
        </Link>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {`${blockCount(report)} · last ${report.days} days · updated ${formatDateOnly(report.updated_at)}`}
        </p>
      </div>
      <ActionMenu
        label={`Actions for ${report.title}`}
        items={[
          {
            label: 'Open',
            onSelect: () => navigate(customReportPath(report.id)),
          },
          {
            label: 'Edit',
            onSelect: () => navigate(customReportEditPath(report.id)),
          },
          {
            label: 'Delete',
            tone: 'danger',
            onSelect: () => onDelete(report),
          },
        ]}
      />
    </li>
  );
}

/**
 * One saved-report row's worth of placeholder, in the list's place, so the
 * page moves at most by the rows beyond the first when the list arrives.
 */
function SavedReportsSkeleton() {
  return (
    <SkeletonRegion label="Loading your reports">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div>
          <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-48" /></div>
          <div className="mt-0.5 flex h-4 items-center"><Skeleton className="h-3 w-64 max-w-full" /></div>
        </div>
        <Skeleton className="h-6 w-7" />
      </div>
    </SkeletonRegion>
  );
}

/** Deletes a saved report after the reader confirms, then lists the reports again. */
function useReportDeletion(reload: () => Promise<void>) {
  const [pending, setPending] = useState<CustomReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = async (report: CustomReport) => {
    setProblem(null);
    try {
      await deleteCustomReport(report.id);
      await reload();
    } catch (error) {
      setProblem(getErrorMessage(error));
    }
  };
  return {
    pending,
    problem,
    ask: setPending,
    cancel: () => setPending(null),
    confirm,
  };
}

function SavedReportsBody({
  reports, onDelete
}: {
  readonly reports: readonly CustomReport[];
  readonly onDelete: (report: CustomReport) => void;
}) {
  if (reports.length === 0) {
    return (
      <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 sm:px-6">
        No custom report yet. Use New custom report to combine the sections you need from every report, with your own headings and notes.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {reports.map((report) => <SavedReportRow key={report.id} report={report} onDelete={onDelete} />)}
    </ul>
  );
}

function SavedReports() {
  const {
    reports, loading, error, reload
  } = useCustomReports();
  const deletion = useReportDeletion(reload);
  const pending = deletion.pending;
  if (loading && reports.length === 0) return <SavedReportsSkeleton />;
  if (error !== null) return <div className="p-4 sm:px-6"><SectionPlaceholder variant="error" message={error} /></div>;
  return (
    <>
      <ErrorAlert message={deletion.problem} spacingClassName="mx-4 mt-3 sm:mx-6 " />
      <SavedReportsBody reports={reports} onDelete={deletion.ask} />
      {pending !== null && (
        <DeleteReportModal
          report={pending}
          isOpen
          onClose={deletion.cancel}
          onConfirm={() => void deletion.confirm(pending)}
        />
      )}
    </>
  );
}

/** The saved custom reports on the Reports page, newest change first, each with its Open / Edit / Delete menu. */
export function CustomReportsPanel() {
  return (
    <section aria-labelledby="custom-reports-heading" className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
        <h3 id="custom-reports-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Your custom reports</h3>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">The sections you picked from every report, in your order, with your own headings, text, images and videos.</p>
      </div>
      <SavedReports />
    </section>
  );
}
