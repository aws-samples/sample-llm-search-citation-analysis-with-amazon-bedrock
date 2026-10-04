import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { CompetitorOutrankedKeyword } from '../../../../api/reports';
import { OutrankedKeywordsSection } from './OutrankedKeywordsSection';
import {
  buildOutrankedKeyword, loadedRollup
} from './rollupSection-fixtures';

function renderOutranked(...rows: CompetitorOutrankedKeyword[]) {
  return render(<OutrankedKeywordsSection {...loadedRollup({ outranked_keywords: rows })} />);
}

describe('OutrankedKeywordsSection — content', () => {
  it('renders each outranked keyword as a row in the table', () => {
    renderOutranked(buildOutrankedKeyword({ keyword: 'best running shoes' }));
    expect(screen.getByText('best running shoes')).toBeInTheDocument();
  });

  it('renders rank values with a # prefix', () => {
    renderOutranked(buildOutrankedKeyword({
      their_best_rank: 2,
      our_best_rank: 5,
      rank_delta: 3,
    }));
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#5')).toBeInTheDocument();
  });

  it('renders a dash when our_best_rank is null (we never appeared)', () => {
    renderOutranked(buildOutrankedKeyword({
      their_best_rank: 2,
      our_best_rank: null,
      rank_delta: null,
    }));
    // Dash should be present in the our-rank cell.
    const cells = screen.getAllByRole('cell');
    expect(cells.some((c) => c.textContent === '—')).toBe(true);
  });

  it('renders the rank delta with a + sign prefix', () => {
    renderOutranked(buildOutrankedKeyword({
      our_best_rank: 4,
      rank_delta: 3,
    }));
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('renders the providers list joined by commas', () => {
    renderOutranked(buildOutrankedKeyword({ providers: ['openai', 'perplexity'] }));
    expect(screen.getByText('openai, perplexity')).toBeInTheDocument();
  });
});

describe('OutrankedKeywordsSection — empty state', () => {
  it('renders a friendly empty message when no keywords are outranked', () => {
    renderOutranked();
    expect(
      screen.getByText(/Maintain current investment/i),
    ).toBeInTheDocument();
  });
});
