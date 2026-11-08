/**
 * The Excel columns of the Domain Overview tables: raw DataForSEO values (numbers stay numbers, unknown is an
 * empty cell), full URLs and ISO dates, with the unit in the header.
 */
import {
  rounded, type ExcelTableColumn
} from '../../../exporters/tableExcel';
import type {
  DomainSnapshotSummary, RankedKeywordRow, SerpCompetitorRow, TopPageRow
} from '../../../types/api/seoDomains';
import { INTENT_LABELS } from '../../KeywordResearch/explorer/keywordExplorerFormat';

/** The estimated monthly visits of a row, as whole visits. */
function estimatedTraffic<TRow extends { readonly etv: number | null }>(): ExcelTableColumn<TRow> {
  return {
    header: 'Est. traffic',
    value: (row) => rounded(row.etv, 0),
  };
}

/** The estimated traffic and keyword count both the pages and the competitors carry. */
function trafficAndKeywords<TRow extends { readonly etv: number | null }>(
  keywords: (row: TRow) => number | null
): ReadonlyArray<ExcelTableColumn<TRow>> {
  return [
    estimatedTraffic<TRow>(),
    {
      header: 'Keywords',
      value: keywords,
    },
  ];
}

export const KEYWORD_EXCEL_COLUMNS: ReadonlyArray<ExcelTableColumn<RankedKeywordRow>> = [
  {
    header: 'Keyword',
    value: (row) => row.keyword,
  },
  {
    header: 'Intent',
    value: (row) => INTENT_LABELS[row.intent],
  },
  {
    header: 'Position',
    value: (row) => row.position,
  },
  {
    header: 'Organic position',
    value: (row) => row.organic_position,
  },
  {
    header: 'Search volume',
    value: (row) => row.search_volume,
  },
  estimatedTraffic<RankedKeywordRow>(),
  {
    header: 'CPC (USD)',
    value: (row) => rounded(row.cpc, 2),
  },
  {
    header: 'Keyword difficulty',
    value: (row) => row.keyword_difficulty,
  },
  {
    header: 'URL',
    value: (row) => row.url,
  },
];

export const PAGE_EXCEL_COLUMNS: ReadonlyArray<ExcelTableColumn<TopPageRow>> = [
  {
    header: 'URL',
    value: (row) => row.url,
  },
  ...trafficAndKeywords<TopPageRow>((row) => row.keywords),
];

export const COMPETITOR_EXCEL_COLUMNS: ReadonlyArray<ExcelTableColumn<SerpCompetitorRow>> = [
  {
    header: 'Domain',
    value: (row) => row.domain,
  },
  {
    header: 'Visibility (0-1)',
    value: (row) => rounded(row.visibility, 3),
  },
  {
    header: 'Avg. position',
    value: (row) => rounded(row.avg_position, 1),
  },
  {
    header: 'Median position',
    value: (row) => rounded(row.median_position, 1),
  },
  ...trafficAndKeywords<SerpCompetitorRow>((row) => row.keywords_count),
];

export const SNAPSHOT_EXCEL_COLUMNS: ReadonlyArray<ExcelTableColumn<DomainSnapshotSummary>> = [
  {
    header: 'Snapshot',
    value: (snapshot) => snapshot.snapshot_at,
  },
  {
    header: 'Organic keywords',
    value: (snapshot) => snapshot.organic_keywords,
  },
  {
    header: 'Est. traffic / month',
    value: (snapshot) => rounded(snapshot.estimated_traffic, 0),
  },
  {
    header: 'Traffic value / month (USD)',
    value: (snapshot) => rounded(snapshot.traffic_cost, 2),
  },
  {
    header: 'Keywords stored',
    value: (snapshot) => snapshot.keywords_stored,
  },
];
