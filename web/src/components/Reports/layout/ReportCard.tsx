import type { ReactNode } from 'react';

/** The frame of a report card (a target, a brief, an idea, a recommendation), kept on one printed page. */
export const REPORT_CARD_CLASS = 'border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 avoid-break-inside';

interface HeaderProps {
  readonly title: ReactNode;
  /** The line under the title (a URL, the target keyword). */
  readonly detail: ReactNode;
  /** What sits on the right of the title: a priority badge, a date. */
  readonly aside: ReactNode;
}

/** A report card's title row: the title over its detail line, with an aside on the right. */
export function ReportCardHeader({
  title, detail, aside
}: HeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 mb-2">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        {detail}
      </div>
      {aside}
    </div>
  );
}
