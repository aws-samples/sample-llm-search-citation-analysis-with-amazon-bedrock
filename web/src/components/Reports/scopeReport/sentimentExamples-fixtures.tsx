import { vi } from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import type {
  ReportScope, VisibilityResponse
} from '../../../types';
import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import type {
  SentimentExample, SentimentExamplesResponse, SentimentLabel
} from '../../../types/domain/sentimentExamples';
import {
  buildSentimentExample, buildSentimentExamplesResponse
} from '../../../types/domain/sentimentExamples-fixtures';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { createMockJsonResponse } from '../../../test/fetchResponses';
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
const COUNTED_VISIBILITY: VisibilityResponse = buildVisibility({
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

/** The first page of three matching answers: two shown, the third behind `next_token` `'page-2'`. */
export const FIRST_EXAMPLE_PAGE: SentimentExamplesResponse = buildSentimentExamplesResponse({
  total: 3,
  examples: [buildSentimentExample({ brand: 'Hotel Sol' }), buildSentimentExample({ brand: 'Sol Spa' })],
  next_token: 'page-2',
});

/** The last page after `FIRST_EXAMPLE_PAGE`. */
export const LAST_EXAMPLE_PAGE: SentimentExamplesResponse = buildSentimentExamplesResponse({
  total: 3,
  examples: [buildSentimentExample({ brand: 'Sol Beach Club' })],
  next_token: null,
});

/** Answers the requests in order: the first with `pages[0]`, the next with `pages[1]`, … */
export function answerExamplePages(...pages: readonly SentimentExamplesResponse[]): void {
  pages.forEach((page) => {
    mockAuthenticatedFetch.mockImplementationOnce(() => Promise.resolve(createMockJsonResponse(page)));
  });
}

/** The brand line of every answer card listed, in order. */
export function listedBrands(): Array<string | null | undefined> {
  return within(screen.getByRole('list', { name: 'Answers' }))
    .getAllByRole('listitem')
    .map((item) => item.firstElementChild?.firstElementChild?.textContent);
}
