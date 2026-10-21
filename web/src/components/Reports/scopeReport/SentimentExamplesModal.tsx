import type { ReportScope } from '../../../types';
import type {
  SentimentExamplesResponse, SentimentLabel
} from '../../../types/domain/sentimentExamples';
import { Modal } from '../../ui/Modal';
import { SectionPlaceholder } from '../layout/SectionPlaceholder';
import { providerName } from '../../../constants/providers';
import { SentimentExampleCard } from './SentimentExampleCard';
import { SENTIMENT_TONES } from './sentimentTone';
import {
  useSentimentExamplePages, type SentimentExamplePages
} from './useSentimentExamplePages';

interface Props {
  readonly scope: ReportScope;
  /** The scope's name, as the report shows it. */
  readonly scopeLabel: string;
  readonly sentiment: SentimentLabel;
  /** The AI engine whose answers to list; `null` for every engine. */
  readonly provider: string | null;
  readonly onClose: () => void;
}

/** "All engines", or the engine's name. */
export function engineLabel(provider: string | null): string {
  return provider === null ? 'All engines' : providerName(provider);
}

/** "Showing 20 of 37" when more answers remain, else how many answers the list holds. */
function countLine(shown: number, total: number): string {
  if (shown < total) return `Showing ${shown} of ${total}`;
  return total === 1 ? '1 answer' : `${total} answers`;
}

interface ExamplesListProps {
  readonly pages: SentimentExamplePages;
  readonly data: SentimentExamplesResponse;
  readonly sentiment: SentimentLabel;
  readonly provider: string | null;
}

function LoadMoreButton({ pages }: { readonly pages: SentimentExamplePages }) {
  return (
    <button
      type="button"
      onClick={pages.loadMore}
      disabled={pages.loadingMore}
      className="mt-4 px-4 py-2 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
    >
      {pages.loadingMore ? 'Loading more answers…' : 'Load more answers'}
    </button>
  );
}

function ExamplesList({
  pages, data, sentiment, provider
}: ExamplesListProps) {
  const { examples } = pages;
  if (examples.length === 0) {
    const from = provider === null ? '' : ` from ${providerName(provider)}`;
    return (
      <output className="block">
        <SectionPlaceholder variant="empty" message={`No ${sentiment} answers${from} in the latest runs of this scope any more.`} />
      </output>
    );
  }
  return (
    <>
      <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{countLine(examples.length, data.total)}</p>
      <ol className="space-y-4" aria-label="Answers">
        {examples.map((example) => (
          <SentimentExampleCard
            // Stryker disable next-line StringLiteral: React list key only; the rendered cards are identical
            key={`${example.timestamp}::${example.keyword}::${example.provider}::${example.persona}::${example.brand}`}
            example={example}
          />
        ))}
      </ol>
      {data.next_token !== null && <LoadMoreButton pages={pages} />}
    </>
  );
}

/**
 * The answers behind one count of the sentiment split per engine: each
 * keyword's latest run in the scope, your brands only, newest first, a page
 * at a time ("Load more answers" appends the next one). The fetch starts on
 * open and is aborted on close; the modal never prints.
 */
export function SentimentExamplesModal({
  scope, scopeLabel, sentiment, provider, onClose
}: Props) {
  const pages = useSentimentExamplePages(scope, sentiment, provider);
  const {
    data, loading, error
  } = pages;

  const truncatedNote = data?.keywords_truncated ? ' · not every keyword of the scope is included' : '';

  return (
    <div className="print-hidden">
      <Modal isOpen onClose={onClose} size="4xl" title={`${SENTIMENT_TONES[sentiment].label} answers · ${engineLabel(provider)}`}>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{`${scopeLabel} · each keyword's latest run${truncatedNote}`}</p>
        {loading && (
          <output className="block">
            <SectionPlaceholder variant="loading" message="Loading the answers…" />
          </output>
        )}
        {!loading && error !== null && (
          <div role="alert">
            <SectionPlaceholder variant="error" message={error} />
          </div>
        )}
        {!loading && data !== null && <ExamplesList pages={pages} data={data} sentiment={sentiment} provider={provider} />}
      </Modal>
    </div>
  );
}
