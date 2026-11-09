import {
  Link, useLocation
} from 'react-router-dom';
import { StrokeIcon } from '../../ui/StrokeIcon';
import { DOCUMENT_TEXT_PATHS } from '../../ui/iconPaths';

/**
 * "Save as PDF": opens the report in a new tab with `?print=1`, where the
 * print layout opens the browser's print dialog once the data is in
 * (`usePrintMode`). The scope, period and market in the URL come along.
 */
export function SavePdfLink() {
  const {
    pathname, search, hash
  } = useLocation();
  const query = new URLSearchParams(search);
  query.set('print', '1');
  return (
    <Link
      to={{
        pathname,
        search: `?${query.toString()}`,
        hash,
      }}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Save as PDF (opens in a new tab)"
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
    >
      <StrokeIcon className="h-4 w-4" paths={DOCUMENT_TEXT_PATHS} aria-hidden="true" />
      Save as PDF
    </Link>
  );
}
