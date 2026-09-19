import type {
  CitationGap, CitationGapsResponse 
} from '../../../../types';
import {
  PriorityBadge,
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  pendingSectionPlaceholder,
} from '../../layout';

interface Props {
  readonly gaps: CitationGapsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const MAX_TARGETS = 15;

const COLUMNS: ReadonlyArray<ReportTableColumn<CitationGap>> = [
  {
    header: 'Priority',
    render: (source) => <PriorityBadge priority={source.priority} inline />,
  },
  {
    header: 'Domain & URL',
    render: (source) => (
      <>
        <p className="font-medium text-gray-900 dark:text-white">
          {source.domain}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-md">
          {source.url}
        </p>
      </>
    ),
  },
  {
    header: 'Keyword',
    cellClassName: 'text-xs',
    render: (source) => source.keyword ?? '—',
  },
  {
    header: 'Cites',
    render: (source) => source.citation_count,
  },
  {
    header: 'Providers',
    render: (source) => source.provider_count,
  },
  {
    header: 'Competitors named',
    cellClassName: 'text-xs',
    render: (source) => (source.competitor_brands.length > 0
      ? source.competitor_brands.slice(0, 3).join(', ')
      : '—'),
  },
];

/**
 * The actionable outreach list: top citation gaps ordered by priority then
 * citation count. Each row tells the strategist *why* the source matters
 * (provider count, citing competitors) so triage doesn't require clicking
 * through to the citation-gaps view.
 *
 * We take from `top_gaps` when the report is across-all-keywords (the
 * cross-keyword shape of the response) and fall back to `gaps` for the
 * single-keyword shape.
 */
export function TopCitationTargetsSection({
  gaps, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: 'Top citation targets',
    loading,
    loadingMessage: 'Loading citation gaps…',
    loadingSubtitle: 'Where to focus PR / outreach effort, ordered by impact.',
    error,
  });
  if (pending) return pending;

  const sources = (gaps?.top_gaps ?? gaps?.gaps ?? []).slice(0, MAX_TARGETS);

  if (sources.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Top citation targets"
        variant="empty"
        message="No citation gaps found. Either every source already cites first-party brands, or no analysis has run for these keywords yet."
      />
    );
  }

  return (
    <ReportSection
      title="Top citation targets"
      subtitle="Sources citing competitors but not us, ordered by priority. Getting first-party brands mentioned on the high-priority sources should produce the biggest visibility lift."
    >
      <ReportTable
        columns={COLUMNS}
        rows={sources}
        rowKey={(source) => source.url}
        alignTop
      />
    </ReportSection>
  );
}
