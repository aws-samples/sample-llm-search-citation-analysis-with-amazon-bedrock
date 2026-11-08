import { keywordSelectionKey } from '../../../hooks/keywordIdentity';
import type { KeywordRow } from '../../../types/api/seo';
import { InfoTooltip } from '../../ui/InfoTooltip';
import type {
  KeywordSort, SortField
} from './keywordExplorerFilters';
import {
  INTENT_LABELS, formatCompetition, formatCpc, formatDifficulty, formatVolume
} from './keywordExplorerFormat';
import { TrendSparkline } from './TrendSparkline';

/** Column help texts. */
const COLUMN_HELP: Partial<Record<SortField, string>> = {
  keyword_difficulty: "Organic ranking difficulty (0-100): higher means harder to reach Google's top 10.",
  cpc: 'Cost per click in USD.',
  competition: 'Paid-search competition from Google Ads (0-1): higher means more advertisers bidding.',
};

const SORTABLE_COLUMNS: ReadonlyArray<{
  field: SortField;
  label: string;
  numeric: boolean 
}> = [
  {
    field: 'keyword',
    label: 'Keyword',
    numeric: false,
  },
  {
    field: 'search_volume',
    label: 'Volume',
    numeric: true,
  },
  {
    field: 'keyword_difficulty',
    label: 'Difficulty',
    numeric: true,
  },
  {
    field: 'cpc',
    label: 'CPC',
    numeric: true,
  },
  {
    field: 'competition',
    label: 'Competition',
    numeric: true,
  },
];

const HEADER_CELL = 'px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap';
const BODY_CELL = 'px-4 py-3 text-sm text-gray-700 whitespace-nowrap';

interface KeywordExplorerTableProps {
  readonly rows: readonly KeywordRow[];
  readonly sort: KeywordSort;
  readonly onSort: (field: SortField) => void;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keyword: string) => void;
  /** The keyword whose results page the SERP panel shows. */
  readonly activeKeyword: string | null;
  readonly onOpenSerp: (keyword: string) => void;
}

function ariaSort(sort: KeywordSort, field: SortField): 'ascending' | 'descending' | 'none' {
  if (sort.field !== field) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function SortHeader({
  field, label, numeric, sort, onSort
}: {
  readonly field: SortField;
  readonly label: string;
  readonly numeric: boolean 
} & Pick<KeywordExplorerTableProps, 'sort' | 'onSort'>) {
  const help = COLUMN_HELP[field];
  return (
    <th scope="col" aria-sort={ariaSort(sort, field)} className={`${HEADER_CELL} ${numeric ? 'text-right' : 'text-left'}`}>
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onSort(field)} className="uppercase tracking-wider hover:text-gray-900">
          {label}
        </button>
        {help && <InfoTooltip label={label} text={help} />}
      </span>
    </th>
  );
}

function KeywordCells({
  row, active, onOpenSerp
}: {
  readonly row: KeywordRow;
  readonly active: boolean;
  readonly onOpenSerp: (keyword: string) => void 
}) {
  return (
    <>
      <td className={BODY_CELL}>
        <button
          type="button"
          onClick={() => onOpenSerp(row.keyword)}
          aria-pressed={active}
          className={`text-left hover:underline ${active ? 'font-semibold text-gray-900' : ''}`}
        >
          {row.keyword}
        </button>
      </td>
      <td className={`${BODY_CELL} text-right tabular-nums`}>{formatVolume(row.search_volume)}</td>
      <td className={BODY_CELL}><TrendSparkline trend={row.trend} keyword={row.keyword} /></td>
      <td className={`${BODY_CELL} text-right tabular-nums`}>{formatDifficulty(row.keyword_difficulty)}</td>
      <td className={`${BODY_CELL} text-right tabular-nums`}>{formatCpc(row.cpc)}</td>
      <td className={`${BODY_CELL} text-right tabular-nums`}>{formatCompetition(row.competition)}</td>
      <td className={BODY_CELL}>{INTENT_LABELS[row.intent]}</td>
    </>
  );
}

function KeywordTableRow({
  row, selected, onToggle, active, onOpenSerp
}: {
  readonly row: KeywordRow;
  readonly selected: boolean;
  readonly onToggle: (keyword: string) => void;
  readonly active: boolean;
  readonly onOpenSerp: (keyword: string) => void;
}) {
  return (
    <tr>
      <td className={BODY_CELL}>
        <input
          type="checkbox"
          aria-label={`Select ${row.keyword}`}
          checked={selected}
          onChange={() => onToggle(row.keyword)}
          className="rounded-sm border-gray-300"
        />
      </td>
      <KeywordCells row={row} active={active} onOpenSerp={onOpenSerp} />
    </tr>
  );
}

function PlainHeader({ label }: { readonly label: string }) {
  return <th scope="col" className={`${HEADER_CELL} text-left`}>{label}</th>;
}

/** Research rows with selection, sortable metric columns and a click-through to the SERP panel. */
export function KeywordExplorerTable({
  rows, sort, onSort, selectedKeys, onToggle, activeKeyword, onOpenSerp
}: KeywordExplorerTableProps) {
  const [keywordColumn, volumeColumn, ...metricColumns] = SORTABLE_COLUMNS;
  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={HEADER_CELL}><span className="sr-only">Select</span></th>
            <SortHeader {...keywordColumn} sort={sort} onSort={onSort} />
            <SortHeader {...volumeColumn} sort={sort} onSort={onSort} />
            <PlainHeader label="Trend" />
            {metricColumns.map((column) => <SortHeader key={column.field} {...column} sort={sort} onSort={onSort} />)}
            <PlainHeader label="Intent" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => (
            <KeywordTableRow
              key={row.keyword}
              row={row}
              selected={selectedKeys.has(keywordSelectionKey(row.keyword))}
              onToggle={onToggle}
              active={row.keyword === activeKeyword}
              onOpenSerp={onOpenSerp}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
