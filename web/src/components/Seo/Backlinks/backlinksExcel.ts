/**
 * Excel export of the backlinks table page on screen (only that page: the rest would be more paid requests).
 * One column set per tab, raw values: flags as Yes / No, the rel attributes space-separated.
 */
import {
  exportTableToExcel, spaced, yesNo, type ExcelTableColumn
} from '../../../exporters/tableExcel';
import type {
  BacklinksTab, BacklinksTableRows, ReferringDomainRow, TopPageRow
} from '../../../types/api/seoBacklinks';
import { TAB_LABELS } from './backlinksFormat';

type Columns = {[TTab in BacklinksTab]: ReadonlyArray<ExcelTableColumn<BacklinksTableRows[TTab]>>};

/** Columns read the same way from every tab whose rows carry the field. */
const SPAM_SCORE: ExcelTableColumn<Pick<ReferringDomainRow, 'spam_score'>> = {
  header: 'Spam Score',
  value: (row) => row.spam_score,
};
const FIRST_SEEN: ExcelTableColumn<Pick<ReferringDomainRow, 'first_seen'>> = {
  header: 'First Seen',
  value: (row) => row.first_seen,
};
const BACKLINKS: ExcelTableColumn<Pick<TopPageRow, 'backlinks'>> = {
  header: 'Backlinks',
  value: (row) => row.backlinks,
};
const RANK: ExcelTableColumn<Pick<TopPageRow, 'rank'>> = {
  header: 'Rank',
  value: (row) => row.rank,
};
const BROKEN_BACKLINKS: ExcelTableColumn<Pick<TopPageRow, 'broken_backlinks'>> = {
  header: 'Broken Backlinks',
  value: (row) => row.broken_backlinks,
};

export const BACKLINKS_EXCEL_COLUMNS: Columns = {
  backlinks: [
    {
      header: 'Domain',
      value: (row) => row.domain_from,
    },
    {
      header: 'Source URL',
      value: (row) => row.url_from,
    },
    {
      header: 'Target URL',
      value: (row) => row.url_to,
    },
    {
      header: 'Anchor',
      value: (row) => row.anchor,
    },
    {
      header: 'Type',
      value: (row) => row.item_type,
    },
    {
      header: 'Dofollow',
      value: (row) => yesNo(row.dofollow),
    },
    {
      header: 'Rel Attributes',
      value: (row) => spaced(row.rel_attributes),
    },
    {
      header: 'Domain Rank',
      value: (row) => row.domain_from_rank,
    },
    {
      header: 'Source Page Rank',
      value: (row) => row.page_from_rank,
    },
    {
      header: 'Link Rank',
      value: (row) => row.rank,
    },
    SPAM_SCORE,
    FIRST_SEEN,
    {
      header: 'Last Seen',
      value: (row) => row.last_seen,
    },
    {
      header: 'Lost',
      value: (row) => yesNo(row.is_lost),
    },
    {
      header: 'Broken',
      value: (row) => yesNo(row.is_broken),
    },
    {
      header: 'Links Count',
      value: (row) => row.links_count,
    },
  ],
  referring_domains: [
    {
      header: 'Domain',
      value: (row) => row.domain,
    },
    BACKLINKS,
    {
      header: 'Referring Pages',
      value: (row) => row.referring_pages,
    },
    RANK,
    SPAM_SCORE,
    FIRST_SEEN,
    BROKEN_BACKLINKS,
    {
      header: 'Broken Pages',
      value: (row) => row.broken_pages,
    },
  ],
  top_pages: [
    {
      header: 'Page',
      value: (row) => row.page,
    },
    BACKLINKS,
    {
      header: 'Referring Domains',
      value: (row) => row.referring_domains,
    },
    RANK,
    BROKEN_BACKLINKS,
  ],
};

const FILE_PARTS: Record<BacklinksTab, string> = {
  backlinks: 'backlinks',
  referring_domains: 'referring-domains',
  top_pages: 'top-pages',
};

/** `backlinks-<table>-<target slug>-<YYYY-MM-DD>.xlsx`, one sheet named after the tab. */
export function exportBacklinksExcel<TTab extends BacklinksTab>(
  tab: TTab, rows: ReadonlyArray<BacklinksTableRows[TTab]>, target: string
): Promise<void> {
  const columns: ReadonlyArray<ExcelTableColumn<BacklinksTableRows[TTab]>> = BACKLINKS_EXCEL_COLUMNS[tab];
  return exportTableToExcel({
    columns,
    rows,
    sheetName: TAB_LABELS[tab],
    filePrefix: `backlinks-${FILE_PARTS[tab]}`,
    scopeLabel: target,
  });
}
