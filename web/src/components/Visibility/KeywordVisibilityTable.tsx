import { useState } from 'react';
import type { KeywordVisibilityRow } from '../../types';
import type { KpiId } from '../../constants/kpiDefinitions';
import { formatKpi } from '../../formatting/kpiFormatter';
import {
  kpiColumn, type ReportTableColumn
} from '../Reports/layout';
import { InfoTooltip } from '../ui/InfoTooltip';
import { OverviewPanel } from './OverviewPanel';

/** The KPIs of each keyword row, in column order. */
const KEYWORD_KPIS = [
  'mention_rate',
  'share_of_voice',
  'visibility_score',
  'average_position',
  'citation_rate',
  'answers',
] as const satisfies readonly KpiId[];

type KeywordSortKey = 'keyword' | (typeof KEYWORD_KPIS)[number];

/** Sorted ascending the first time they are picked: names A→Z, positions best (lowest) first. */
const ASCENDING_FIRST: ReadonlySet<KeywordSortKey> = new Set<KeywordSortKey>(['keyword', 'average_position']);

interface SortableColumn extends ReportTableColumn<KeywordVisibilityRow> { readonly key: KeywordSortKey }

const TITLE = 'Keywords in this scope';

const COLUMNS: readonly SortableColumn[] = [
  {
    key: 'keyword',
    header: 'Keyword',
    render: (row) => (
      <>
        <span className="font-medium text-gray-900">{row.keyword}</span>
        {!row.has_data && <span className="block text-xs text-gray-400">No analysis data yet</span>}
      </>
    ),
  },
  ...KEYWORD_KPIS.map((id) => ({
    key: id,
    ...kpiColumn<KeywordVisibilityRow>(id, (row) => formatKpi(id, row.kpis?.[id])),
  })),
];

/** `left` before `right`: unknown values last whatever the direction. */
function compareKnownFirst(left: number | null, right: number | null, descending: boolean): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

function compareRows(left: KeywordVisibilityRow, right: KeywordVisibilityRow, key: KeywordSortKey, descending: boolean): number {
  if (key === 'keyword') {
    const comparison = left.keyword.localeCompare(right.keyword, undefined, { sensitivity: 'base' });
    return descending ? -comparison : comparison;
  }
  return compareKnownFirst(left.kpis?.[key] ?? null, right.kpis?.[key] ?? null, descending);
}

function ariaSort(active: boolean, descending: boolean): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return descending ? 'descending' : 'ascending';
}

function SortHeader({
  column, active, descending, onSort
}: {
  readonly column: SortableColumn;
  readonly active: boolean;
  readonly descending: boolean;
  readonly onSort: (key: KeywordSortKey) => void;
}) {
  const arrow = descending ? ' ↓' : ' ↑';
  return (
    <th aria-sort={ariaSort(active, descending)} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
      <button type="button" onClick={() => onSort(column.key)} className="uppercase hover:text-gray-900">
        {column.header}
        {active && <span aria-hidden="true">{arrow}</span>}
      </button>
      {column.info !== undefined && <InfoTooltip label={column.header} text={column.info} />}
    </th>
  );
}

function BodyRows({ rows }: { readonly rows: readonly KeywordVisibilityRow[] }) {
  if (rows.length === 0) {
    return (
      <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-500">No keywords in this scope.</td></tr>
    );
  }
  return (
    <>
      {rows.map((row) => (
        // Stryker disable next-line StringLiteral: Tailwind-only dimming; the "No analysis data yet" hint and dashes carry the state
        <tr key={row.keyword} className={row.has_data ? '' : 'bg-gray-50 text-gray-400'}>
          {COLUMNS.map((column) => <td key={column.key} className="px-3 py-2 text-sm">{column.render(row)}</td>)}
        </tr>
      ))}
    </>
  );
}

/**
 * Every keyword of the scope with its latest run's KPIs, sortable by any
 * column; unknown values (and keywords without data) stay last.
 */
export function KeywordVisibilityTable({ rows }: { readonly rows: readonly KeywordVisibilityRow[] }) {
  const [sortKey, setSortKey] = useState<KeywordSortKey>('visibility_score');
  const [descending, setDescending] = useState(true);

  const sortBy = (key: KeywordSortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous);
      return;
    }
    setSortKey(key);
    setDescending(!ASCENDING_FIRST.has(key));
  };

  const sorted = [...rows].sort((left, right) => compareRows(left, right, sortKey, descending));

  return (
    <OverviewPanel title={TITLE}>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table aria-label={TITLE} className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((column) => (
                <SortHeader key={column.key} column={column} active={column.key === sortKey} descending={descending} onSort={sortBy} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            <BodyRows rows={sorted} />
          </tbody>
        </table>
      </div>
    </OverviewPanel>
  );
}
