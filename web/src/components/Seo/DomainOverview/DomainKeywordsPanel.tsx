import type {
  DomainKeywordFilters,
  DomainKeywordSort,
  DomainKeywordsRequest,
  DomainKeywordsResponse,
  DomainTargetRequest,
  RankedKeywordRow,
} from '../../../types/api/seoDomains';
import {
  Chip, CompactNumber, PositionBadge, ScoreChip, UrlCell
} from '../../ui/tableCells';
import { INTENT_LABELS } from '../../KeywordResearch/explorer/keywordExplorerFormat';
import {
  DomainPagedPanel, etvColumn, type DomainListProps, type ListColumn, type PagedListSpec
} from './DomainPagedPanel';
import {
  KEYWORD_BOUNDS, keywordConditionCount, keywordFilters
} from './domainFilters';
import {
  INTENT_TONES, usdText
} from './domainFormat';
import {
  firstQuery, pagedRequest
} from './domainPagedQuery';

const FIRST_QUERY = firstQuery<DomainKeywordSort>('traffic');

const SPEC: PagedListSpec<DomainKeywordFilters> = {
  bounds: KEYWORD_BOUNDS,
  countConditions: keywordConditionCount,
  toFilters: keywordFilters,
  loadingLabel: 'Loading ranked keywords',
  skeletonColumns: 8,
  caption: 'Ranked keywords',
};

/** The first page Analyze asks for. */
export function firstKeywordsRequest(target: DomainTargetRequest): DomainKeywordsRequest {
  return pagedRequest(target, FIRST_QUERY, keywordFilters);
}

/** "Position 4 (organic 2)" when the organic rank differs from the absolute one. */
function positionTitle(row: RankedKeywordRow): string | undefined {
  if (row.position === null) return undefined;
  if (row.organic_position === null || row.organic_position === row.position) return `Position ${row.position}`;
  return `Position ${row.position} (organic ${row.organic_position})`;
}

const COLUMNS: ReadonlyArray<ListColumn<RankedKeywordRow, DomainKeywordSort>> = [
  {
    id: 'keyword',
    header: 'Keyword',
    render: (row) => <span className="block min-w-[10rem] font-medium text-gray-900">{row.keyword}</span>,
  },
  {
    id: 'intent',
    header: 'Intent',
    help: 'The main search intent DataForSEO assigns to the keyword.',
    render: (row) => <Chip tone={INTENT_TONES[row.intent]}>{INTENT_LABELS[row.intent]}</Chip>,
  },
  {
    id: 'rank',
    header: 'Rank',
    help: 'Google position counting every results-page element; the tooltip adds the organic-only rank when it differs.',
    sortKey: 'rank',
    numeric: true,
    render: (row) => <PositionBadge position={row.position} title={positionTitle(row)} />,
  },
  {
    id: 'volume',
    header: 'Volume',
    sortKey: 'volume',
    numeric: true,
    render: (row) => <CompactNumber value={row.search_volume} />,
  },
  etvColumn('traffic'),
  {
    id: 'cpc',
    header: 'CPC',
    sortKey: 'cpc',
    numeric: true,
    render: (row) => usdText(row.cpc),
  },
  {
    id: 'difficulty',
    header: 'Difficulty',
    sortKey: 'score',
    numeric: true,
    render: (row) => <ScoreChip value={row.keyword_difficulty} label="Keyword difficulty" />,
  },
  {
    id: 'url',
    header: 'URL',
    render: (row) => <UrlCell url={row.url} text={row.relative_url} />,
  },
];

/** The keywords the target ranks for, paged, sorted and filtered by DataForSEO (loaded by Analyze). */
export function DomainKeywordsPanel(props: DomainListProps<DomainKeywordsRequest, DomainKeywordsResponse>) {
  return (
    <DomainPagedPanel {...props} spec={SPEC} initialQuery={FIRST_QUERY} columns={COLUMNS}
      rowKey={(row) => `${row.keyword}|${row.url ?? ''}`}
      exported={{
        table: 'keywords',
        tableName: 'ranked keywords',
      }} />
  );
}
