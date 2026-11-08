import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import {
  fetchSerp, isSeoApiConfigured, researchKeywords
} from '../../../api/seo';
import { useMarketKeywords } from '../../../hooks/useSeoSettings';
import {
  buildMarketKeywordsRead, pickTrackedKeyword, renderExplorer
} from './KeywordExplorer-fixtures';
import {
  NO_TRACKED_KEYWORD, PICKER_LABEL
} from './TrackedKeywordPicker';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../hooks/useSeoSettings');

beforeEach(() => {
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  vi.mocked(useMarketKeywords).mockReturnValue(buildMarketKeywordsRead());
});

describe('TrackedKeywordPicker', () => {
  it('lists the tracked keywords of the header market after the placeholder', () => {
    renderExplorer();

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options.slice(0, 3)).toStrictEqual([`${PICKER_LABEL}…`, 'hotel lisboa', 'pousada rio']);
  });

  it('fills the seed keyword with the picked keyword', async () => {
    await pickTrackedKeyword('pousada rio');

    expect(screen.getByLabelText('Seed keyword')).toHaveValue('pousada rio');
  });

  it('makes no paid call when a keyword is picked', async () => {
    await pickTrackedKeyword('pousada rio');

    expect(researchKeywords).toHaveBeenCalledTimes(0);
    expect(fetchSerp).toHaveBeenCalledTimes(0);
  });

  it('researches the picked keyword when Search is pressed', async () => {
    vi.mocked(researchKeywords).mockReturnValue(new Promise(vi.fn()));
    const user = await pickTrackedKeyword('hotel lisboa');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(researchKeywords).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'hotel lisboa' }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it('shows a loading placeholder instead of the picker while the keywords load', () => {
    vi.mocked(useMarketKeywords).mockReturnValue(buildMarketKeywordsRead({
      data: [],
      loaded: false,
    }));
    renderExplorer();

    expect(screen.getByText('Loading tracked keywords')).toBeInTheDocument();
    expect(screen.queryByLabelText(PICKER_LABEL)).not.toBeInTheDocument();
  });

  it('links to Settings › Keywords when the market has no tracked keyword', () => {
    vi.mocked(useMarketKeywords).mockReturnValue(buildMarketKeywordsRead({ data: [] }));
    renderExplorer();

    expect(screen.getByText(NO_TRACKED_KEYWORD, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings › Keywords' })).toHaveAttribute('href', '/settings/keywords');
  });

  it('hides the picker when the keywords cannot be read', () => {
    vi.mocked(useMarketKeywords).mockReturnValue(buildMarketKeywordsRead({
      data: [],
      error: 'Network error',
    }));
    renderExplorer();

    expect(screen.queryByLabelText(PICKER_LABEL)).not.toBeInTheDocument();
  });
});
