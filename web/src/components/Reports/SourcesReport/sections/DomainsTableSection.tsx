import { Link } from 'react-router-dom';
import type {
  SourceRow, VisibilityResponse
} from '../../../../types';
import {
  ReportTable, type ReportTableColumn
} from '../../layout/ReportTable';
import { domainFigureColumns } from '../../layout/domainColumns';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

const CITATION_GAPS_PATH = '/citation-gaps';

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
  ...domainFigureColumns({
    citations: 'Answers that cite the domain at least once.',
    citationRate: 'Share of the AI answers that cite the domain as a source.',
    citationShare: 'The domain\'s share of all the sources the answers cite; each domain counts once per answer.',
    engines: 'The AI engines whose answers cite the domain.',
    keywords: 'How many keywords have an answer citing the domain.',
  }),
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
