import { useEffect } from 'react';
import type { ReportScope } from '../../../types';
import type {
  SentimentExamplesResponse, SentimentLabel
} from '../../../types/domain/sentimentExamples';
import { useSentimentExamples } from '../../../hooks/useSentimentExamples';
import { Modal } from '../../ui/Modal';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';
import { SectionPlaceholder } from '../layout/SectionPlaceholder';
import { engineName } from '../charts';
import { SentimentExampleCard } from './SentimentExampleCard';
import { SENTIMENT_TONES } from './sentimentTone';

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
  return provider === null ? 'All engines' : engineName(provider);
}

/** "Showing 20 of 37" when the list is cut, else how many answers it holds. */
function countLine({
  examples, total
}: SentimentExamplesResponse): string {
  if (examples.length < total) return `Showing ${examples.length} of ${total}`;
  return total === 1 ? '1 answer' : `${total} answers`;
}

function ExamplesList({
  data, sentiment, provider
}: {
  readonly data: SentimentExamplesResponse;
  readonly sentiment: SentimentLabel;
  readonly provider: string | null;
}) {
  if (data.examples.length === 0) {
    const from = provider === null ? '' : ` from ${engineName(provider)}`;
    return (
      <output className="block">
        <SectionPlaceholder variant="empty" message={`No ${sentiment} answers${from} in the latest runs of this scope any more.`} />
      </output>
    );
  }
  return (
    <>
      <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{countLine(data)}</p>
      <ol className="space-y-4" aria-label="Answers">
        {data.examples.map((example) => (
          <SentimentExampleCard
            // Stryker disable next-line StringLiteral: React list key only; the rendered cards are identical
            key={`${example.timestamp}::${example.keyword}::${example.provider}::${example.persona}::${example.brand}`}
            example={example}
          />
        ))}
      </ol>
    </>
  );
}

/**
 * The answers behind one count of the sentiment split per engine: each
 * keyword's latest run in the scope, your brands only, newest first. The
 * fetch starts on open and is aborted on close; the modal never prints.
 */
export function SentimentExamplesModal({
  scope, scopeLabel, sentiment, provider, onClose
}: Props) {
  const {
    data, loading, error, fetchSentimentExamples
  } = useSentimentExamples();
  const scopeKey = encodeReportScope(scope);

  useEffect(() => {
    void fetchSentimentExamples(decodeReportScope(scopeKey), sentiment, provider ?? undefined);
  }, [scopeKey, sentiment, provider, fetchSentimentExamples]);

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
        {!loading && data !== null && <ExamplesList data={data} sentiment={sentiment} provider={provider} />}
      </Modal>
    </div>
  );
}
