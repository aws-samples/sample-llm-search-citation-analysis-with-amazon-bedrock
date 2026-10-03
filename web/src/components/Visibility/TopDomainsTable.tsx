import type { SourceRow } from '../../types';
import {
  ReportTable, type ReportTableColumn
} from '../Reports/layout';
import {
  domainFigureColumns, type DomainColumnInfo
} from '../Reports/layout/domainColumns';

/** What each figure of a cited domain counts, in its column tooltip. */
export const DOMAIN_COLUMN_INFO = {
  citations: 'Answers citing the domain.',
  citationRate: 'The share of all answers that cite the domain.',
  citationShare: 'The domain\'s share of every domain citation in the answers.',
  engines: 'The AI engines whose answers cite the domain.',
  keywords: 'How many keywords\' answers cite the domain.',
} as const satisfies DomainColumnInfo;

function DomainCell({ source }: { readonly source: SourceRow }) {
  return (
    <>
      <span className="font-medium text-gray-900">{source.domain}</span>
      {source.owned && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">owned</span>}
    </>
  );
}

const COLUMNS: ReadonlyArray<ReportTableColumn<SourceRow>> = [
  {
    header: 'Domain',
    render: (source) => <DomainCell source={source} />,
  },
  ...domainFigureColumns(DOMAIN_COLUMN_INFO),
];

function ownedRowClass(source: SourceRow): string {
  return source.owned ? 'bg-emerald-50' : '';
}

/** The most cited domains of the scope, most cited first, the brand's own domains badged and tinted. */
export function TopDomainsTable({ sources }: { readonly sources: readonly SourceRow[] }) {
  return (
    <ReportTable
      columns={COLUMNS}
      rows={sources}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(source) => source.domain}
      rowClassName={ownedRowClass}
    />
  );
}
