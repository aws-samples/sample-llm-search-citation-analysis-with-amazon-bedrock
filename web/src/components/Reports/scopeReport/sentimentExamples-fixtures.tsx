import { vi } from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import type {
  ReportScope, VisibilityResponse
} from '../../../types';
import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import type {
  SentimentExample, SentimentLabel
} from '../../../types/domain/sentimentExamples';
import { buildSentimentExample } from '../../../types/domain/sentimentExamples-fixtures';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { buildKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  buildEngineKpis, buildVisibility
} from '../layout/reportPayload-fixtures';
import { groupScope } from '../../ui/reportScope-fixtures';
import { SentimentExamplesModal } from './SentimentExamplesModal';
import { SentimentCountTable } from './SentimentCountTable';
import { SentimentExampleCard } from './SentimentExampleCard';

/**
 * The sentiment examples of the Sentiment report for the specs: counts of
 * every engine together, OpenAI and Gemini, and the modal listing the
 * answers behind one of them. Mock `../../../infrastructure` with
 * `test/infrastructureMock` in the spec.
 */

function split(overrides: Partial<SentimentSplit>): SentimentSplit {
  return {
    positive: 0,
    neutral: 0,
    mixed: 0,
    negative: 0,
    ...overrides,
  };
}

/** Every engine: 3 positive, 0 neutral, 1 mixed, 4 negative; OpenAI 1 / 0 / 1 / 3; Gemini 2 / 0 / 0 / 1. */
export const COUNTED_VISIBILITY: VisibilityResponse = buildVisibility({
  scope: {
    kind: 'group',
    label: 'Hotel Sol',
    keyword_count: 2,
  },
  kpis: buildKpis({
    sentiment_split: split({
      positive: 3,
      mixed: 1,
      negative: 4,
    }),
  }),
  engines: [
    buildEngineKpis('openai', {
      sentiment_split: split({
        positive: 1,
        mixed: 1,
        negative: 3,
      }),
    }),
    buildEngineKpis('gemini', {
      sentiment_split: split({
        positive: 2,
        negative: 1,
      }),
    }),
  ],
});

export const HOTEL_SOL_SCOPE: ReportScope = groupScope('hotel-sol');

/** Answers every request with `body`. */
export function stubExamplesAnswer(body: unknown, status = 200): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(body, status)));
}

/** The URL of the only request made. */
export function requestedUrl(): unknown {
  return mockAuthenticatedFetch.mock.calls[0]?.[0];
}

/** The abort signal of the only request made. */
export function requestSignal(): AbortSignal | null | undefined {
  return mockAuthenticatedFetch.mock.calls[0]?.[1]?.signal;
}

/** One example card in its list (`buildSentimentExample()` unless given), with its full answer unfolded when `unfold`. */
export function renderExampleCard(example: SentimentExample = buildSentimentExample(), unfold = false) {
  const rendered = render(<ul><SentimentExampleCard example={example} /></ul>);
  if (unfold) fireEvent.click(screen.getByRole('button', { name: 'Show full answer' }));
  return rendered;
}

/** The count table of the "Hotel Sol" group with COUNTED_VISIBILITY. */
export function renderCountTable(visibility: VisibilityResponse = COUNTED_VISIBILITY) {
  return render(<SentimentCountTable scope={HOTEL_SOL_SCOPE} visibility={visibility} />);
}

interface ModalOptions {
  readonly sentiment?: SentimentLabel;
  readonly provider?: string | null;
}

/** The negative OpenAI answers of the "Hotel Sol" group, unless `options` pick another count; returns the close spy too. */
export function renderExamplesModal({
  sentiment = 'negative', provider = 'openai'
}: ModalOptions = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <SentimentExamplesModal scope={HOTEL_SOL_SCOPE} scopeLabel="Hotel Sol" sentiment={sentiment} provider={provider} onClose={onClose} />,
    ),
  };
}
