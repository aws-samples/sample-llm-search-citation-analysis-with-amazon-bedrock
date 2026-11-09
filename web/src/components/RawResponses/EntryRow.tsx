import type { S3Item } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { formatSize } from './fileSizeFormatter';
import { formatDayName } from './folderListing';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CHEVRON_RIGHT_PATHS, DOCUMENT_TEXT_PATHS, PHOTO_PATHS
} from '../ui/iconPaths';

const FOLDER_PATHS = ['M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z'];

const ICON_PATHS: Record<S3Item['type'], string[]> = {
  folder: FOLDER_PATHS,
  image: PHOTO_PATHS,
  file: DOCUMENT_TEXT_PATHS,
};

/** What the row says about the entry: its kind, and for a file its size and when it was written. */
function entryDetails(entry: S3Item): string {
  if (entry.type === 'folder') return 'Folder';
  const parts = [
    entry.type === 'image' ? 'Image' : 'File',
    entry.size ? formatSize(entry.size) : null,
    entry.last_modified ? formatDate(entry.last_modified) : null,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

interface EntryRowProps {
  entry: S3Item;
  onOpen: (entry: S3Item) => void;
}

/** One folder or file in the listing: a full-width row button. Run-day folders read as a date. */
export const EntryRow = ({
  entry, onOpen
}: EntryRowProps) => {
  const day = entry.type === 'folder' ? formatDayName(entry.name) : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
      >
        <StrokeIcon className="w-4 h-4 shrink-0 text-gray-500" paths={ICON_PATHS[entry.type]} />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-gray-900 break-all">{day ?? entry.name}</span>
          {day !== null && <span className="text-xs text-gray-500 tabular-nums">{entry.name}</span>}
        </span>
        <span className="shrink-0 text-xs text-gray-500 tabular-nums">{entryDetails(entry)}</span>
        <StrokeIcon className="w-4 h-4 shrink-0 text-gray-500" paths={CHEVRON_RIGHT_PATHS} />
      </button>
    </li>
  );
};
