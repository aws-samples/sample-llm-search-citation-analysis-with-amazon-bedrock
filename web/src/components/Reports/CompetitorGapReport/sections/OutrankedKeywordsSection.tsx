import type { CompetitorOutrankedKeyword } from '../../../../api/reports';
import { providerName } from '../../../../constants/providers';
import {
  emphasisColumn,
  ReportSection,
  ReportSectionNote,
  ReportTable,
  type ReportTableColumn,
} from '../../layout';
import {
  gateRollup, type RollupSectionProps
} from './rollupSection';
import { useScopedList } from '../../../../hooks/useScopedList';
import {
  isOutrankedKeyword, OUTRANKED_KEYWORDS_PAGING
} from '../../../../api/scopedListPagings';
import { ScopedListFooter } from '../../../ui/ScopedListFooter';

const TITLE = 'Outranked keywords';

const COLUMNS: ReadonlyArray<ReportTableColumn<CompetitorOutrankedKeyword>> = [
  emphasisColumn('Keyword', (row) => row.keyword),
  {
    header: 'Their rank',
    numeric: true,
    render: (row) => `#${row.their_best_rank}`,
  },
  {
    header: 'Our rank',
    numeric: true,
    render: (row) => (row.our_best_rank ? `#${row.our_best_rank}` : '—'),
  },
  {
    header: 'Delta',
    numeric: true,
    render: (row) => (row.rank_delta === null ? '—' : (
      <span className="text-red-700 dark:text-red-400 font-mono font-semibold">
        {`+${row.rank_delta}`}
      </span>
    )),
  },
  {
    header: 'AI engines',
    cellClassName: 'text-xs',
    render: (row) => row.providers.map(providerName).join(', ') || '—',
  },
];

/**
 * Keywords where this competitor outranks every first-party brand,
 * sorted by rank delta descending so the biggest gaps anchor the
 * top of the table — those are the keywords where the strategist
 * would invest first.
 */
export function OutrankedKeywordsSection(props: RollupSectionProps) {
  // An older answer carries no `response`: the rollup's own list is the whole list.
  const outrankedList = useScopedList(props.response ?? null, props.request ?? null, OUTRANKED_KEYWORDS_PAGING, isOutrankedKeyword);
  const gate = gateRollup(TITLE, props);
  if (!gate.ready) return gate.placeholder;

  const outranked = props.response === undefined || props.response === null ? gate.value.outranked_keywords : outrankedList.items;
  if (outranked.length === 0) {
    return (
      <ReportSectionNote title={TITLE} subtitle="No keywords where this competitor beats us right now.">
        Maintain current investment on the keywords already covered.
      </ReportSectionNote>
    );
  }

  return (
    <ReportSection
      title={TITLE}
      subtitle="Keywords where this competitor's best rank beats every first-party brand. Largest gap to us first."
    >
      <ReportTable
        columns={COLUMNS}
        rows={outranked}
        rowKey={(row) => row.keyword}
      />
      <ScopedListFooter list={outrankedList} noun="keywords" />
    </ReportSection>
  );
}
