import {
  useMemo, useState
} from 'react';
import type {
  S3BrowseResponse, S3Item
} from '../../types';
import { EntryRow } from './EntryRow';
import {
  entryLimit, filterEntries, groupByMonth, isDayFolder, orderEntries, type EntryGroup
} from './folderListing';
import { LoadMoreButton } from '../ui/LoadMoreButton';
import { SearchIcon } from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import { ARCHIVE_PATHS } from '../ui/iconPaths';

type FolderListing = Pick<S3BrowseResponse, 'folders' | 'files' | 'total_folders' | 'total_files' | 'folder_count' | 'file_count' | 'truncated'>;

interface FolderFileListProps {
  browseData: FolderListing;
  onFolderClick: (folder: S3Item) => void;
  onFileClick: (file: S3Item) => void;
  /** Set when the folder has entries past the loaded pages. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

const NOUNS = {
  folder: ['folder', 'folders'],
  file: ['file', 'files'],
  entry: ['entry', 'entries'],
  day: ['day', 'days'],
} as const;

const plural = (count: number, noun: keyof typeof NOUNS): string => `${count.toLocaleString('en-US')} ${NOUNS[noun][count === 1 ? 0 : 1]}`;

/** The footer: what the folder holds, or how much of it is loaded while pages remain. */
function listingSummary(listing: FolderListing, paged: boolean): string {
  const loaded = listing.folders.length + listing.files.length;
  const known = listing.folder_count !== undefined && listing.file_count !== undefined;
  if (paged && known) {
    return `${loaded.toLocaleString('en-US')} of ${plural((listing.folder_count ?? 0) + (listing.file_count ?? 0), 'entry')} loaded`;
  }
  const folders = plural(listing.folder_count ?? listing.total_folders, 'folder');
  const files = plural(listing.file_count ?? listing.total_files, 'file');
  return `${folders}, ${files}${paged ? ' loaded' : ''}`;
}

export const FolderFileList = ({
  browseData, onFolderClick, onFileClick, onLoadMore, loadingMore = false
}: FolderFileListProps) => {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const paged = onLoadMore !== undefined;
  const entries = useMemo(
    () => orderEntries(browseData.folders, browseData.files, !paged),
    [browseData.folders, browseData.files, paged]
  );

  if (entries.length === 0) {
    return <EmptyState />;
  }

  const limit = entryLimit(entries);
  const matching = filterEntries(entries, query);
  const capped = !expanded && query.trim() === '' && matching.length > limit;
  const shown = capped ? matching.slice(0, limit) : matching;
  const open = (entry: S3Item) => (entry.type === 'folder' ? onFolderClick(entry) : onFileClick(entry));

  return (
    <div>
      {entries.length > limit && <FilterBox query={query} onChange={setQuery} />}
      {browseData.truncated === true && <TruncatedNotice />}

      {shown.length === 0
        ? <p className="py-6 text-center text-sm text-gray-500">No entries match “{query.trim()}”.</p>
        : <EntryGroups groups={groupByMonth(shown)} onOpen={open} />}

      {capped ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          Show all {plural(matching.length, isDayFolder(entries[0]) ? 'day' : 'entry')}
        </button>
      ) : (
        <LoadMoreButton onLoadMore={onLoadMore} loading={loadingMore} label="Load more" layoutClassName="mt-3 " />
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
        {capped && `Showing the latest ${shown.length.toLocaleString('en-US')} · `}
        {listingSummary(browseData, paged)}
      </div>
    </div>
  );
};

interface EntryGroupsProps {
  groups: EntryGroup[];
  onOpen: (entry: S3Item) => void;
}

/** The rows in one bordered list, with a month heading above each month of run days. */
const EntryGroups = ({
  groups, onOpen
}: EntryGroupsProps) => (
  <div className="rounded-lg border border-gray-200 divide-y divide-gray-200 overflow-hidden">
    {groups.map((group) => (
      <section key={group.label ?? group.entries[0].path} aria-label={group.label ?? undefined}>
        {group.label !== null && (
          <h3 className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-600">{group.label}</h3>
        )}
        <ul className="divide-y divide-gray-200">
          {group.entries.map((entry) => <EntryRow key={entry.path} entry={entry} onOpen={onOpen} />)}
        </ul>
      </section>
    ))}
  </div>
);

interface FilterBoxProps {
  query: string;
  onChange: (query: string) => void;
}

const FilterBox = ({
  query, onChange
}: FilterBoxProps) => (
  <div className="relative mb-3 max-w-sm">
    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
    <input
      type="search"
      aria-label="Filter loaded entries"
      placeholder="Filter by name or date..."
      value={query}
      onChange={(event) => onChange(event.target.value)}
      className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
    />
  </div>
);

const TruncatedNotice = () => (
  <output className="mb-3 block border-l-4 border-amber-500 bg-gray-50 px-3 py-2 text-xs text-amber-800">
    This folder is too large to list in full, so its newest entries may be missing.
  </output>
);

const EmptyState = () => (
  <div className="text-center py-12 text-gray-500">
    <StrokeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" paths={ARCHIVE_PATHS} />
    <p className="text-sm">No data found</p>
    <p className="text-xs mt-1">Run an analysis to generate data</p>
  </div>
);
