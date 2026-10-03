import { Link } from 'react-router-dom';
import type {
  SourceRow, VisibilityResponse
} from '../../../../types';
import { formatKpi } from '../../../../formatting/kpiFormatter';
import { engineName } from '../../charts';
import {
  ReportTable, type ReportTableColumn
} from '../../layout/ReportTable';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

const CITATION_GAPS_PATH = '/citation-gaps';

const DOMAIN_CITATIONS_INFO = 'Answers that cite the domain at least once.';

const DOMAIN_RATE_INFO = 'Share of the AI answers that cite the domain as a source.';

const DOMAIN_SHARE_INFO = 'The domain\'s share of all the sources the answers cite; each domain counts once per answer.';

const COLUMNS: ReadonlyArray<ReportTableColumn<SourceRow>> = [
  {
    header: 'Domain',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-medium whitespace-nowrap',
    render: (source) => (
      <>
        {source.domain}
        {source.owned && (
          <span className="ml-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Owned
          </span>
        )}
      </>
    ),
  },
  {
    header: 'Citations',
    info: DOMAIN_CITATIONS_INFO,
    render: (source) => source.citations,
  },
  {
    header: 'Citation rate',
    info: DOMAIN_RATE_INFO,
    render: (source) => formatKpi('citation_rate', source.citation_rate),
  },
  {
    header: 'Citation share',
    info: DOMAIN_SHARE_INFO,
    render: (source) => formatKpi('citation_share', source.citation_share),
  },
  {
    header: 'Engines',
    info: 'The AI engines whose answers cite the domain.',
    render: (source) => source.engines.map(engineName).join(', '),
  },
  {
    header: 'Keywords',
    info: 'How many keywords have an answer citing the domain.',
    render: (source) => source.keywords,
  },
];

/** "Listing the 25 most cited of 40 domains." when the API listed only the top of them; `null` otherwise. */
function listedDomainsNote({
  sources, sources_total: total
}: VisibilityResponse): string | null {
  return sources.length < total ? `Listing the ${sources.length} most cited of ${total} domains.` : null;
}

function noSourceCited({ sources }: VisibilityResponse): string | null {
  return sources.length === 0 ? 'No answer cites a source yet.' : null;
}

// Stryker disable next-line BlockStatement: React row key only; the rendered rows are identical
function domainKey(source: SourceRow): string {
  return source.domain;
}

function DomainsTable({ visibility }: { readonly visibility: VisibilityResponse }) {
  const note = listedDomainsNote(visibility);
  return (
    <>
      <ReportTable columns={COLUMNS} rows={visibility.sources} rowKey={domainKey} />
      {note !== null && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{note}</p>}
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        Which sources cite your competitors but not you?
        {' '}
        <Link to={CITATION_GAPS_PATH} className="font-medium underline">See the Citation Gaps analysis</Link>
        .
      </p>
    </>
  );
}

/** Every domain the latest runs cite, most cited first, with the answers, engines and keywords citing it. */
export function DomainsTableSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Cited domains"
      subtitle="The domains the latest runs cite, most cited first. Your owned domains carry a badge."
      emptyMessage={noSourceCited}
    >
      {(visibility) => <DomainsTable visibility={visibility} />}
    </LatestRunSection>
  );
}
