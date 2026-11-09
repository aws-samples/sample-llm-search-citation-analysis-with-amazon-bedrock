import {
  Link, useNavigate
} from 'react-router-dom';
import {
  ArrowRightIcon, Button, PlusIcon
} from '../ui';
import { CustomReportsPanel } from './customReport/CustomReportsPanel';
import { NEW_CUSTOM_REPORT_PATH } from './customReport/customReportRoute';
import {
  REPORT_GROUPS, type ReportEntry, type ReportGroup
} from './reportCatalog';

// Stryker disable next-line StringLiteral: Tailwind-only card styling
const CARD_CLASSES = 'group flex h-full flex-col rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-500';

function ReportCard({ report }: { readonly report: ReportEntry }) {
  return (
    <Link to={report.path} className={CARD_CLASSES}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{report.title}</h4>
        <ArrowRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-700 dark:group-hover:text-gray-200" />
      </div>
      <p className="mt-1 flex-1 text-sm leading-snug text-gray-600 dark:text-gray-300">{report.question}</p>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{`For ${report.audience}`}</p>
    </Link>
  );
}

function ReportGroupSection({ group }: { readonly group: ReportGroup }) {
  const headingId = `report-group-${group.id}`;
  return (
    <section aria-labelledby={headingId} className="grid grid-cols-1 gap-3 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <h3 id={headingId} className="text-sm font-semibold text-gray-900 dark:text-white lg:pt-4">{group.question}</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {group.reports.map((report) => (
          <li key={report.path}><ReportCard report={report} /></li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Reports page: the built-in reports under the question each answers,
 * then the saved custom reports, with "New custom report" as the one primary
 * action.
 */
export function ReportsLandingView() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">Reports</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Pick the question you need answered. Every report can be printed or saved as a PDF.
          </p>
        </div>
        <Button className="shrink-0" leadingIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate(NEW_CUSTOM_REPORT_PATH)}>
          New custom report
        </Button>
      </div>

      <div className="space-y-6 divide-y divide-gray-200 dark:divide-gray-700 [&>*+*]:pt-6">
        {REPORT_GROUPS.map((group) => <ReportGroupSection key={group.id} group={group} />)}
      </div>

      <CustomReportsPanel />
    </div>
  );
}
