import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SavePdfLink } from './SavePdfLink';

interface Props {
  /**
   * The report's headline (e.g. "Keyword Deep Dive: best running shoes").
   * Rendered as an H1 at the top of the page.
   */
  readonly title: string;
  /** The report's name in the breadcrumb, when the title carries more (a keyword, a competitor). Defaults to the title. */
  readonly name?: string;
  /**
   * One-line description of what the report covers and who it's for.
   * Helps a reader who picks up the printout cold understand the context.
   */
  readonly subtitle?: string;
  /**
   * The report's controls (scope, keyword, competitor, trend period), in one
   * toolbar row under the title. Screen only: hidden in the print output via
   * `print-hidden`, since the title and subtitle name the scope.
   */
  readonly actions?: ReactNode;
  /** Page actions shown left of "Save as PDF" (e.g. "Edit report"); screen only. */
  readonly headerActions?: ReactNode;
  /**
   * The body of the report — usually a stack of <ReportSection /> elements.
   */
  readonly children: ReactNode;
}

function Breadcrumb({ name }: { readonly name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="print-hidden mb-2 text-sm">
      <ol className="flex min-w-0 items-center gap-1.5 text-gray-500 dark:text-gray-400">
        <li>
          <Link to="/reports" className="rounded-sm hover:text-gray-900 hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 dark:hover:text-white">
            Reports
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li aria-current="page" className="min-w-0 truncate text-gray-700 dark:text-gray-300">{name}</li>
      </ol>
    </nav>
  );
}

/**
 * Standard layout for any report page.
 *
 * A header card with the breadcrumb back to the Reports page, the H1, the
 * report's purpose and the time it was generated (so a printout identifies
 * itself), "Save as PDF" on the right, and the report's controls in one
 * toolbar row. The breadcrumb, the PDF link and the toolbar are screen only
 * (`print-hidden`); on paper the card drops its frame.
 *
 * Reports compose this layout instead of building their own header so every
 * report, on screen and on paper, opens the same way.
 */
export function ReportLayout({
  title,
  name = title,
  subtitle,
  actions,
  headerActions,
  children,
}: Props) {
  const generatedAt = new Date().toLocaleString();

  return (
    <div className="space-y-8">
      <header className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-6 print:border-0 print:p-0">
        <Breadcrumb name={name} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold text-gray-900 dark:text-white sm:text-2xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-300">
                {subtitle}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Generated {generatedAt}
            </p>
          </div>
          <div className="print-hidden flex shrink-0 flex-wrap items-center gap-2">
            {headerActions}
            <SavePdfLink />
          </div>
        </div>
        {actions && (
          <div className="print-hidden mt-4 flex flex-wrap items-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            {actions}
          </div>
        )}
      </header>
      <div className="space-y-8">{children}</div>
    </div>
  );
}
