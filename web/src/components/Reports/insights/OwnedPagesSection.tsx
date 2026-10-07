import { providerName } from '../../../constants/providers';
import type { ReportTableColumn } from '../layout';
import type {
  OwnedPageRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import { MarkedName } from './InsightChip';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';

export const OWNED_PAGES_TITLE = 'Your most-cited pages';

/** What the section says when owned domains are configured but no answer cites one. */
export const OWNED_PAGES_EMPTY = 'No answer of the latest runs cites one of your pages yet.';

/** What the section says while no owned domain is configured. */
export const OWNED_PAGES_UNCONFIGURED = 'Add your own domains in Settings › Brand tracking to see which of your pages the AI engines cite.';

const OWNED_PAGE_COLUMNS: ReadonlyArray<ReportTableColumn<OwnedPageRow>> = [
  {
    header: 'Page',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'break-all',
    render: (row) => <MarkedName name={row.url} marker="Document" tone="watch" marked={row.is_document} />,
  },
  {
    header: 'Section',
    info: 'The site and first path segment the page sits under.',
    render: (row) => row.section,
  },
  {
    header: 'Citations',
    info: 'Answers citing the page.',
    render: (row) => String(row.citations),
  },
  {
    header: 'AI engines',
    render: (row) => row.engines.map(providerName).join(', '),
  },
];

/** " 4 less-cited pages are not shown."; nothing when the 25-row cap left none out. */
function omittedClause(omitted: number): string {
  if (omitted === 0) return '';
  return omitted === 1 ? ' 1 less-cited page is not shown.' : ` ${omitted} less-cited pages are not shown.`;
}

/** The documents against web pages over every owned citation, and how many pages the 25-row cap left out. */
function splitNote({ facts }: ReportInsightsResponse): string | null {
  const {
    document_citations: documents, page_citations: pages, pages_omitted: omitted
  } = facts.owned_pages;
  if (documents + pages === 0) return null;
  return `Documents (PDFs and other downloads): ${documents} citations; web pages: ${pages}.${omittedClause(omitted)}`;
}

/** Your pages the AI engines cite most, with their section, the documents marked. */
export function OwnedPagesSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={OWNED_PAGES_TITLE}
      subtitle="The pages of your own domains the latest runs cite most, and whether they are web pages or documents written for someone else."
      block="insights_owned_pages"
      slice={slice}
      rows={({ facts }) => facts.owned_pages.pages}
      columns={() => OWNED_PAGE_COLUMNS}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.url}
      emptyMessage={({ citations_configured: configured }) => (configured ? OWNED_PAGES_EMPTY : OWNED_PAGES_UNCONFIGURED)}
      note={splitNote}
    />
  );
}
