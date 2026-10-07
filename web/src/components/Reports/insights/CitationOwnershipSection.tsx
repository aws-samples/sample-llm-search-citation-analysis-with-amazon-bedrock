import type {
  CitationOwnershipRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import type { ReportTableColumn } from '../layout';
import { engineColumn } from './insightColumns';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';

export const CITATION_OWNERSHIP_TITLE = 'Who the engines cite';

/** What the section says while no AI engine answered. */
export const OWNERSHIP_EMPTY = 'No AI engine answered yet.';

/** How to split competitors' sites out of everyone else. */
export const ADD_COMPETITOR_DOMAINS = 'Add your competitors\' domains in Settings › Brand tracking to count their sites apart from everyone else.';

/** How to count your own site. */
export const ADD_OWNED_DOMAINS = 'Add your own domains in Settings › Brand tracking to count the citations of your site.';

/** The competitors with configured domains, in the order the API lists them. */
function competitorNames({ facts }: ReportInsightsResponse): string[] {
  return [...new Set(facts.citation_ownership.engines.flatMap((row) => Object.keys(row.competitors)))];
}

function count(value: number | undefined): string {
  return String(value ?? 0);
}

/** Built per response: one column per competitor with domains; "Everyone else" when none has any. */
function ownershipColumns(response: ReportInsightsResponse): ReadonlyArray<ReportTableColumn<CitationOwnershipRow>> {
  const { competitors_configured: competitorsConfigured } = response.facts.citation_ownership;
  return [
    engineColumn<CitationOwnershipRow>(),
    {
      header: 'Your domains',
      info: 'Citations of your own domains: each (answer, URL) pair once.',
      render: (row) => count(row.owned),
    },
    ...competitorNames(response).map((name): ReportTableColumn<CitationOwnershipRow> => ({
      header: name,
      info: `Citations of ${name}'s domains.`,
      render: (row) => count(row.competitors[name]),
    })),
    {
      header: competitorsConfigured ? 'Third parties' : 'Everyone else',
      info: competitorsConfigured ? 'Citations of any other site.' : 'Citations of every site but yours, competitors included.',
      render: (row) => count(row.third_party),
    },
    {
      header: 'All citations',
      render: (row) => count(row.citations),
    },
  ];
}

/** How to measure what is not measured yet. */
function setupNote({ facts }: ReportInsightsResponse): string | null {
  const {
    owned_configured: ownedConfigured, competitors_configured: competitorsConfigured 
  } = facts.citation_ownership;
  if (!ownedConfigured) return ADD_OWNED_DOMAINS;
  return competitorsConfigured ? null : ADD_COMPETITOR_DOMAINS;
}

/** Per AI engine, the citations of your site, of each competitor's sites and of everyone else. */
export function CitationOwnershipSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={CITATION_OWNERSHIP_TITLE}
      subtitle="Per AI engine, how many citations of the latest runs point at your site, at each competitor's sites and at third parties."
      block="insights_citation_ownership"
      slice={slice}
      rows={({ facts }) => facts.citation_ownership.engines}
      columns={ownershipColumns}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.engine}
      emptyMessage={OWNERSHIP_EMPTY}
      note={setupNote}
    />
  );
}
