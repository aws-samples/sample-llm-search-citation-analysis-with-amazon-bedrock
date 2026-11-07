/**
 * Excel exports of the SEO vs GEO report tables: every keyword with its organic and AI figures, and the traffic
 * share of you and each competitor. Positions, volumes, traffic and percentages stay numbers; an organic position
 * read from a results page without your domains in its top 10 is `>10`; unknown is an empty cell.
 */
import {
  rounded, type ExcelTableColumn, type TableExport, yesNo
} from '../../../exporters/tableExcel';
import { SEO_TOP_POSITION } from '../../../constants/seoGeoDefinitions';
import type {
  SeoGeoResponse, SeoGeoRow, TrafficShareEntry
} from '../../../types/api/seo';
import {
  hasOrganicSnapshot, quadrantLabel
} from './seoGeoView';

const FILE_PREFIX = 'seo-vs-geo';

const RANKED_SOURCES: Readonly<Record<'ranked_keywords' | 'rank_tracking', string>> = {
  ranked_keywords: 'Snapshot',
  rank_tracking: 'Tracked',
};

/** `>10` when a results page was read and none of your domains is in its top 10; unknown without one. */
function beyondTop(row: SeoGeoRow): string | null {
  return hasOrganicSnapshot(row) ? `>${String(SEO_TOP_POSITION)}` : null;
}

/** The deeper source's position, as the table shows it: only when it is not the results page's top 10. */
function rankedSource(row: SeoGeoRow): string | null {
  const source = row.organic_position_source;
  if (row.ranked_position === null || source === null || source === 'serp_top10') return null;
  return RANKED_SOURCES[source];
}

export const SEO_GEO_KEYWORD_COLUMNS: ReadonlyArray<ExcelTableColumn<SeoGeoRow>> = [
  {
    header: 'Keyword',
    value: (row) => row.keyword,
  },
  {
    header: 'Volume',
    value: (row) => row.search_volume,
  },
  {
    header: 'Organic position',
    value: (row) => row.organic_position ?? beyondTop(row),
  },
  {
    header: 'Ranked position',
    value: (row) => (rankedSource(row) === null ? null : row.ranked_position),
  },
  {
    header: 'Ranked position source',
    value: rankedSource,
  },
  {
    header: 'Est. traffic',
    value: (row) => rounded(row.estimated_traffic, 0),
  },
  {
    header: 'AI Overview shown',
    value: (row) => yesNo(row.ai_overview_shown),
  },
  {
    header: 'AI Overview cites you',
    value: (row) => yesNo(row.ai_overview_cites_you),
  },
  {
    header: 'AI mention rate (%)',
    value: (row) => rounded(row.ai_mention_rate, 1),
  },
  {
    header: 'Answers',
    value: (row) => row.answers,
  },
  {
    header: 'Citation overlap (%)',
    value: (row) => rounded(row.citation_overlap, 1),
  },
  {
    header: 'Quadrant',
    value: (row) => quadrantLabel(row.quadrant),
  },
];

export const SEO_GEO_TRAFFIC_COLUMNS: ReadonlyArray<ExcelTableColumn<TrafficShareEntry>> = [
  {
    header: 'Brand',
    value: (entry) => entry.name,
  },
  {
    header: 'Est. traffic',
    value: (entry) => rounded(entry.estimated_traffic, 0),
  },
  {
    header: 'Share of est. search traffic (%)',
    value: (entry) => rounded(entry.traffic_share, 1),
  },
  {
    header: 'Share of AI mentions (%)',
    value: (entry) => rounded(entry.share_of_voice, 1),
  },
];

/** The report's scope label; a section shown without one (a custom report block) names the group id or all keywords. */
function scopeOf(response: SeoGeoResponse, scopeLabel: string | undefined): string {
  return scopeLabel ?? response.group_id ?? 'All keywords';
}

export function seoGeoKeywordsExport(response: SeoGeoResponse, scopeLabel?: string): TableExport<SeoGeoRow> {
  return {
    columns: SEO_GEO_KEYWORD_COLUMNS,
    rows: response.rows,
    sheetName: 'SEO vs GEO keywords',
    filePrefix: FILE_PREFIX,
    scopeLabel: scopeOf(response, scopeLabel),
  };
}

export function seoGeoTrafficExport(response: SeoGeoResponse, scopeLabel?: string): TableExport<TrafficShareEntry> {
  return {
    columns: SEO_GEO_TRAFFIC_COLUMNS,
    rows: response.traffic_comparison,
    sheetName: 'SEO vs GEO traffic',
    filePrefix: `${FILE_PREFIX}-traffic`,
    scopeLabel: scopeOf(response, scopeLabel),
  };
}
