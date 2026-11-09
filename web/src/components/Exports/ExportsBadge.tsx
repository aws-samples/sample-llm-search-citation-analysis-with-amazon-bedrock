import { Link } from 'react-router-dom';
import { useExports } from '../../hooks/useExports';
import { StrokeIcon } from '../ui/StrokeIcon';
import { DOWNLOAD_PATHS } from '../ui/iconPaths';

/** The header's link to the Exports page, with the count of finished exports not seen yet. */
export function ExportsBadge() {
  const center = useExports();
  const unseen = center?.unseenCount ?? 0;
  const label = unseen === 0 ? 'Exports' : `Exports, ${unseen} finished not seen`;
  return (
    <Link
      to="/exports"
      aria-label={label}
      title={label}
      className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
    >
      <StrokeIcon className="w-5 h-5" paths={DOWNLOAD_PATHS} aria-hidden="true" />
      {unseen > 0 && (
        <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-gray-900 text-white text-[10px] leading-4 text-center">
          {unseen}
        </span>
      )}
    </Link>
  );
}
