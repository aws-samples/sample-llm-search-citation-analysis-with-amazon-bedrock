import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  /** The keyword no AI engine has answered yet. */
  readonly keyword: string;
  /** Replaces the default sentence, for views that need their own next step. */
  readonly children?: ReactNode;
}

/**
 * Neutral empty state for a keyword with no AI answers yet: what is missing
 * and a link to Run Analysis. "No data yet" is not a failure, so it is grey,
 * never the red error box.
 */
export function NoDataYet({
  keyword, children
}: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 dark:bg-gray-800 px-4 py-4 text-sm text-gray-600">
      <p className="break-words">
        {children ?? <>No AI engine has answered for &ldquo;{keyword}&rdquo; yet. Run an analysis that includes this keyword to see results here.</>}
      </p>
      <Link
        to="/execution"
        className="print-hidden inline-flex items-center mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
      >
        Go to Run Analysis
      </Link>
    </div>
  );
}
