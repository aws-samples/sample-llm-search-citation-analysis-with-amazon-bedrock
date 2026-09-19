import type {
  CompetitorOutrankedKeyword, CompetitorRollup 
} from '../../../../api/reports';
import {
  ReportSection,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';

interface Props {
  readonly rollup: CompetitorRollup | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const COLUMNS: ReadonlyArray<ReportTableColumn<CompetitorOutrankedKeyword>> = [
  {
    header: 'Keyword',
    cellClassName: 'font-medium',
    render: (row) => row.keyword,
  },
  {
    header: 'Their rank',
    render: (row) => `#${row.their_best_rank}`,
  },
  {
    header: 'Our rank',
    render: (row) => (row.our_best_rank ? `#${row.our_best_rank}` : '—'),
  },
  {
    header: 'Delta',
    render: (row) => (
      <span className="text-red-700 dark:text-red-400 font-mono font-semibold">
        {row.rank_delta === null ? '—' : `+${row.rank_delta}`}
      </span>
    ),
  },
  {
    header: 'Providers',
    cellClassName: 'text-xs',
    render: (row) => row.providers.join(', ') || '—',
  },
];

/**
 * Keywords where this competitor outranks every first-party brand,
 * sorted by rank delta descending so the biggest gaps anchor the
 * top of the table — those are the keywords where the strategist
 * would invest first.
 */
export function OutrankedKeywordsSection({
  rollup, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Outranked keywords',
    loading,
    loadingMessage: 'Loading…',
    error,
    value: rollup,
  });
  if (!gate.ready) return gate.placeholder;

  const outranked = gate.value.outranked_keywords;
  if (outranked.length === 0) {
    return (
      <ReportSection
        title="Outranked keywords"
        subtitle="No keywords where this competitor beats us right now."
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Maintain current investment on the keywords already covered.
        </p>
      </ReportSection>
    );
  }

  return (
    <ReportSection
      title="Outranked keywords"
      subtitle="Keywords where this competitor's best rank beats every first-party brand. Largest gap to us first."
    >
      <ReportTable
        columns={COLUMNS}
        rows={outranked}
        rowKey={(row) => row.keyword}
      />
    </ReportSection>
  );
}
