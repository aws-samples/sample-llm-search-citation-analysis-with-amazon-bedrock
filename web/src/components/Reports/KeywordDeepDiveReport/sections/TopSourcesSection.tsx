import type {
  BrandMentionsResponse,
  CitationGapsResponse,
} from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  pendingSectionPlaceholder,
  type SectionFetchState,
} from '../../layout';

interface Props extends SectionFetchState {
  readonly gaps: CitationGapsResponse | null;
  readonly mentions: BrandMentionsResponse | null;
}

const TITLE = 'Top sources';
const MAX_SUPPORTING = 8;
const MAX_GAPS = 8;

/**
 * Two stacked tables: the URLs that already cite first-party brands for this
 * keyword (so we know what's working), and the URLs that only cite
 * competitors (where the work to be done lives). Showing both side-by-side
 * frames the action plan: "double down on the left list, target the right".
 *
 * The first list comes from `gaps.covered_sources` because the citation-gaps
 * endpoint already groups sources by whether first-party brands appear on
 * them; reusing that classification keeps the two lists internally
 * consistent (no source can show up on both).
 */
export function TopSourcesSection({
  gaps, mentions, loading, error,
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: TITLE,
    loading,
    loadingMessage: 'Loading citation sources…',
    error,
  });
  if (pending) return pending;

  if (!gaps) {
    return null;
  }

  const supporting = (gaps.covered_sources ?? []).slice(0, MAX_SUPPORTING);
  const competitorOnly = (gaps.gaps ?? []).slice(0, MAX_GAPS);

  if (supporting.length === 0 && competitorOnly.length === 0) {
    return (
      <ReportSectionPlaceholder
        title={TITLE}
        variant="empty"
        message="No citation sources have been crawled for this keyword yet."
      />
    );
  }

  return (
    <ReportSection
      title={TITLE}
      subtitle="Where citations come from for this keyword — both the wins and the gaps."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SourceList
          heading="Supporting first-party brands"
          tone="positive"
          items={supporting}
          emptyMessage="No sources currently cite your brand for this keyword."
        />
        <SourceList
          heading="Citing competitors only"
          tone="negative"
          items={competitorOnly}
          emptyMessage="No sources cite competitors without also citing first-party brands. Strong position."
        />
      </div>
      {mentions?.config?.tracked_brands.competitors.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Note: no competitors are configured. The right-hand list is calculated
          against the LLM-classified competitor labels in the response, not your
          tracked competitor list.
        </p>
      )}
    </ReportSection>
  );
}

function SourceList({
  heading,
  tone,
  items,
  emptyMessage,
}: {
  readonly heading: string;
  readonly tone: 'positive' | 'negative';
  readonly items: ReadonlyArray<{
    url: string;
    domain: string;
    citation_count: number;
    provider_count: number;
  }>;
  readonly emptyMessage: string;
}) {
  const accentClass =
    tone === 'positive'
      ? 'border-emerald-200 dark:border-emerald-800'
      : 'border-amber-200 dark:border-amber-800';

  return (
    <div
      className={`border ${accentClass} rounded-lg p-4 bg-white dark:bg-gray-800`}
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        {heading}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((source) => (
            <li
              key={source.url}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {source.domain}
                </p>
                <p className="text-gray-500 dark:text-gray-400 truncate">
                  {source.url}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-gray-700 dark:text-gray-300">
                  {source.citation_count}× cited
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  {source.provider_count} provider
                  {source.provider_count === 1 ? '' : 's'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
