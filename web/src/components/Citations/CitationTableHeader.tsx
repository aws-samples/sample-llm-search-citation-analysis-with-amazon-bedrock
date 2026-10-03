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

const SortableHeader = ({
  column, label, sort, onSort
}: CitationTableHeaderProps & {
  readonly column: SortColumn;
  readonly label: string 
}) => (
  <th
    className={sortableClass(sort.column === column)}
    onClick={() => onSort(column)}
  >
    <div className="flex items-center gap-1">
      {label}
      <SortIcon active={sort.column === column} direction={sort.direction} />
    </div>
  </th>
);

export const CitationTableHeader = ({
  sort, onSort 
}: CitationTableHeaderProps) => {
  return (
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
        <SortableHeader column="domain" label="Domain" sort={sort} onSort={onSort} />
        <SortableHeader column="keywords" label="Keywords" sort={sort} onSort={onSort} />
        <SortableHeader column="citations" label="Citations" sort={sort} onSort={onSort} />
      </tr>
    </thead>
  );
};
