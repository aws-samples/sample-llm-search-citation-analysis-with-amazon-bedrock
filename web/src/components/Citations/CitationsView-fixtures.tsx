import {
  fireEvent, render, screen
} from '@testing-library/react';
import { vi } from 'vitest';
import { answerEveryFetch } from '../../test/fetchStubs';
import { buildCitationsPage } from '../../hooks/useMarketCitations-fixtures';
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
