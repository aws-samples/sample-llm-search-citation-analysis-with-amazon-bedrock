import {
  fireEvent, render, screen
} from '@testing-library/react';
import { scrollSentinelIntoView } from '../../test/intersectionObserverMock';
import { vi } from 'vitest';
import { answerEveryFetch } from '../../test/fetchStubs';
import { createMockJsonResponse } from '../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  answerTwoCitationPages, buildCitationsPage
} from '../../hooks/useMarketCitations-fixtures';
import type { CitationsPage } from '../../types';
import { CitationsView } from './CitationsView';

export const ARTICLE_PAGE = buildCitationsPage({
  top_urls: [{
    url: 'https://example.com/article1',
    citation_count: 5,
    keyword_count: 1,
  }],
  total_urls: 2,
  total_citation_count: 7,
  matched_urls: 1,
});

/** The view with every `GET /citations` answered by `page`. */
export function renderCitationsView(page: CitationsPage = ARTICLE_PAGE) {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answerEveryFetch(page);
  return render(<CitationsView />);
}

/** Sets the view's Type filter to videos. */
export function setupVideoFilter(): void {
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'video' } });
}

/** The two-page list of `answerTwoCitationPages`, except that the first request for page 2 answers HTTP 500. */
export function answerTwoCitationPagesFailingOnce(): void {
  answerTwoCitationPages();
  const answerPage = mockAuthenticatedFetch.getMockImplementation();
  const asksForPage2 = (input: unknown) => new URL(String(input)).searchParams.get('next_token') === 'page-2';
  mockAuthenticatedFetch.mockImplementation((input, init) => {
    // This call is already recorded: it is the first request for page 2 when only one such call exists.
    if (asksForPage2(input) && mockAuthenticatedFetch.mock.calls.filter(([url]) => asksForPage2(url)).length === 1) {
      return Promise.resolve(createMockJsonResponse({ error: 'unavailable' }, 500));
    }
    return answerPage === undefined ? Promise.reject(new RangeError('No fetch answer')) : answerPage(input, init);
  });
}

/**
 * The view over the two pages of `answerTwoCitationPages` (or `answer`), once
 * the first row is on screen, scrolled to the end of the list.
 */
export async function renderScrolledCitationsView(answer: () => void = answerTwoCitationPages): Promise<void> {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answer();
  render(<CitationsView />);
  await screen.findByText('a.example');
  scrollSentinelIntoView();
}
