/**
 * The columns of the three backlinks tables. A column with a `sortField`
 * re-asks the server sorted on it (the field names of
 * `lambda/shared/backlinks_filters.py` `SORT_FIELDS`).
 */
import type { ReactNode } from 'react';
import type { DataColumn } from '../../ui/DataTable';
import {
  Chip, ScoreChip, UrlCell, pageColumn, type ChipTone
} from '../../ui/tableCells';
import type {
  BacklinkRow, BacklinksTab, BacklinksTableRows, ReferringDomainRow, TopPageRow
} from '../../../types/api/seoBacklinks';
import {
  UNKNOWN_VALUE, formatDay, formatMetric
} from './backlinksFormat';

/** A backlinks table column; its `sortKey` is the server sort field. */
export type BacklinksColumn<TRow> = DataColumn<TRow>;

type TableColumns = {[TTab in BacklinksTab]: ReadonlyArray<BacklinksColumn<BacklinksTableRows[TTab]>>};

const SPAM_HELP = 'Estimated spam risk (0-100). Higher scores are more likely manipulative or low quality; a heuristic, not a judgement.';

type NumericField<TRow> = {[K in keyof TRow]: TRow[K] extends number | null ? K : never}[keyof TRow] & string;

/** A sortable number column whose server sort field is the row field of the same name. */
function metricColumn<TRow>(field: NumericField<TRow>, header: string, help?: string): BacklinksColumn<TRow> {
  return {
    id: field,
    header,
    help,
    sortKey: field,
    numeric: true,
    render: (row) => formatMetric(row[field] as number | null),
  };
}

/** The spam score column: `—` (unknown) is kept distinct from 0. */
function spamColumn<TRow extends { readonly spam_score: number | null }>(): BacklinksColumn<TRow> {
  return {
    id: 'spam_score',
    header: 'Spam',
    help: SPAM_HELP,
    sortKey: 'spam_score',
    numeric: true,
    render: (row) => <ScoreChip value={row.spam_score} label="Spam score" />,
  };
}

/** The date a link or domain was first found, sorted on the server. */
function firstSeenColumn<TRow>(render: (row: TRow) => ReactNode): BacklinksColumn<TRow> {
  return {
    id: 'first_seen',
    header: 'First seen',
    sortKey: 'first_seen',
    render,
  };
}

/** `https://blog.example.org/a/b` → `/a/b`, middle-truncated to 48 characters. */
export function shortPath(url: string | null): string {
  if (url === null) return UNKNOWN_VALUE;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '') || '/';
  return path.length <= 48 ? path : `${path.slice(0, 22)}…${path.slice(-25)}`;
}

function LinkFlags({ row }: { readonly row: BacklinkRow }) {
  const flags: ReadonlyArray<readonly [string, ChipTone] | null> = [
    row.is_lost ? ['Lost', 'red'] : null,
    row.is_broken ? ['Broken', 'amber'] : null,
    row.dofollow === false ? ['Nofollow', 'neutral'] : null,
    row.links_count !== null && row.links_count > 1 ? [`${row.links_count} links`, 'blue'] : null,
  ];
  return (
    <span className="flex min-w-[9rem] flex-wrap gap-1">
      {flags.filter((flag) => flag !== null).map(([flag, tone]) => <Chip key={flag} tone={tone}>{flag}</Chip>)}
    </span>
  );
}

function SourceCell({ row }: { readonly row: BacklinkRow }) {
  return (
    <span className="flex max-w-[15rem] flex-col">
      <span className="truncate font-medium text-gray-900">{(row.domain_from ?? UNKNOWN_VALUE).replace(/^www\./, '')}</span>
      <span className="text-xs text-gray-500"><UrlCell url={row.url_from} text={shortPath(row.url_from)} className="max-w-[15rem]" /></span>
    </span>
  );
}

const BACKLINK_COLUMNS: ReadonlyArray<BacklinksColumn<BacklinkRow>> = [
  {
    id: 'source',
    header: 'Source',
    help: 'Page linking to the target',
    render: (row) => <SourceCell row={row} />,
  },
  {
    id: 'target',
    header: 'Target',
    help: 'Destination on the target site',
    render: (row) => <UrlCell url={row.url_to} text={shortPath(row.url_to)} className="max-w-[15rem]" />,
  },
  {
    id: 'anchor',
    header: 'Anchor',
    help: 'Text or format of the link',
    render: (row) => (row.anchor === null
      ? <span className="text-gray-500">No anchor text</span>
      : <span className="block max-w-[11rem] truncate" title={row.anchor}>{row.anchor}</span>),
  },
  {
    id: 'flags',
    header: 'Flags',
    render: (row) => <LinkFlags row={row} />,
  },
  metricColumn('rank', 'Link', 'Authority of the linking page (0-100)'),
  metricColumn('domain_from_rank', 'DA', 'Authority of the linking domain (0-100)'),
  spamColumn(),
  firstSeenColumn((row) => (
    <span className="flex flex-col">
      <span>{formatDay(row.first_seen)}</span>
      {row.last_seen !== null && <span className="text-xs text-gray-500">Last {formatDay(row.last_seen)}</span>}
    </span>
  )),
];

const REFERRING_DOMAIN_COLUMNS: ReadonlyArray<BacklinksColumn<ReferringDomainRow>> = [
  {
    id: 'domain',
    header: 'Domain',
    sortKey: 'domain',
    render: (row) => row.domain ?? UNKNOWN_VALUE,
  },
  metricColumn('backlinks', 'Backlinks'),
  metricColumn('referring_pages', 'Referring pages'),
  metricColumn('rank', 'Rank', 'Authority of the referring domain (0-100)'),
  spamColumn(),
  firstSeenColumn((row) => formatDay(row.first_seen)),
  {
    id: 'issues',
    header: 'Issues',
    sortKey: 'broken_backlinks',
    render: (row) => `Broken links: ${formatMetric(row.broken_backlinks)} / Broken pages: ${formatMetric(row.broken_pages)}`,
  },
];

const TOP_PAGE_COLUMNS: ReadonlyArray<BacklinksColumn<TopPageRow>> = [
  pageColumn((row) => row.page, (row) => shortPath(row.page)),
  metricColumn('backlinks', 'Backlinks'),
  metricColumn('referring_domains', 'Referring domains'),
  metricColumn('rank', 'Rank'),
  metricColumn('broken_backlinks', 'Broken backlinks'),
];

export const TABLE_COLUMNS: TableColumns = {
  backlinks: BACKLINK_COLUMNS,
  referring_domains: REFERRING_DOMAIN_COLUMNS,
  top_pages: TOP_PAGE_COLUMNS,
};

const ROW_IDENTITIES: {[TTab in BacklinksTab]: (row: BacklinksTableRows[TTab]) => string} = {
  backlinks: (row) => `${row.url_from ?? ''}>${row.url_to ?? ''}`,
  referring_domains: (row) => row.domain ?? '',
  top_pages: (row) => row.page ?? '',
};

/** Each row with a React key from its identity (the n-th repeat of an identity gets `#n`). */
export function withRowKeys<TTab extends BacklinksTab>(
  tab: TTab, rows: ReadonlyArray<BacklinksTableRows[TTab]>
): Array<{
  readonly row: BacklinksTableRows[TTab];
  readonly key: string;
}> {
  const identity: (row: BacklinksTableRows[TTab]) => string = ROW_IDENTITIES[tab];
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = identity(row);
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    return {
      row,
      key: repeat === 0 ? base : `${base}#${repeat}`,
    };
  });
}

/** The sort column each table opens on: newest links, strongest domains and pages. */
export const DEFAULT_SORT_FIELDS: Record<BacklinksTab, string> = {
  backlinks: 'first_seen',
  referring_domains: 'backlinks',
  top_pages: 'backlinks',
};
