import type {
  SortColumn, SortConfig 
} from '../../exporters/citationParser';
import { CHEVRON_DOWN_PATHS } from '../ui/iconPaths';
import { StrokeIcon } from '../ui/StrokeIcon';

interface CitationTableHeaderProps {
  sort: SortConfig;
  onSort: (column: SortColumn) => void;
}

function SortIcon({
  active, direction 
}: {
  readonly active: boolean;
  readonly direction: 'asc' | 'desc' 
}) {
  if (!active) return null;
  const paths = direction === 'desc' ? CHEVRON_DOWN_PATHS : ['M5 15l7-7 7 7'];
  return <StrokeIcon className="w-3 h-3" paths={paths} strokeWidth={2} />;
}

function sortableClass(isActive: boolean): string {
  const base = 'px-6 py-3 text-left text-xs font-medium uppercase w-28 cursor-pointer hover:bg-gray-100 transition-colors select-none';
  return isActive ? `${base} text-gray-900` : `${base} text-gray-500`;
}

export const CitationTableHeader = ({
  sort, onSort 
}: CitationTableHeaderProps) => {
  return (
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
        <th
          className={sortableClass(sort.column === 'domain')}
          onClick={() => onSort('domain')}
        >
          <div className="flex items-center gap-1">
            Domain
            <SortIcon active={sort.column === 'domain'} direction={sort.direction} />
          </div>
        </th>
        <th
          className={sortableClass(sort.column === 'keywords')}
          onClick={() => onSort('keywords')}
        >
          <div className="flex items-center gap-1">
            Keywords
            <SortIcon active={sort.column === 'keywords'} direction={sort.direction} />
          </div>
        </th>
        <th
          className={sortableClass(sort.column === 'citations')}
          onClick={() => onSort('citations')}
        >
          <div className="flex items-center gap-1">
            Citations
            <SortIcon active={sort.column === 'citations'} direction={sort.direction} />
          </div>
        </th>
      </tr>
    </thead>
  );
};
