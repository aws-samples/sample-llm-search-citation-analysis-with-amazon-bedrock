import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { OutrankedKeywordsSection } from './OutrankedKeywordsSection';
import { buildRollup } from './OutrankedKeywordsSection-fixtures';

describe('OutrankedKeywordsSection — content', () => {
  it('renders each outranked keyword as a row in the table', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([
          {
            keyword: 'best running shoes',
            their_best_rank: 1,
            our_best_rank: 3,
            rank_delta: 2,
            providers: ['openai'],
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('best running shoes')).toBeInTheDocument();
  });

  it('renders rank values with a # prefix', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([
          {
            keyword: 'kw',
            their_best_rank: 2,
            our_best_rank: 5,
            rank_delta: 3,
            providers: ['openai'],
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#5')).toBeInTheDocument();
  });

  it('renders a dash when our_best_rank is null (we never appeared)', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([
          {
            keyword: 'kw',
            their_best_rank: 2,
            our_best_rank: null,
            rank_delta: null,
            providers: ['openai'],
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    // Dash should be present in the our-rank cell.
    const cells = screen.getAllByRole('cell');
    expect(cells.some((c) => c.textContent === '—')).toBe(true);
  });

  it('renders the rank delta with a + sign prefix', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([
          {
            keyword: 'kw',
            their_best_rank: 1,
            our_best_rank: 4,
            rank_delta: 3,
            providers: ['openai'],
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('renders the providers list joined by commas', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([
          {
            keyword: 'kw',
            their_best_rank: 1,
            our_best_rank: 3,
            rank_delta: 2,
            providers: ['openai', 'perplexity'],
          },
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('openai, perplexity')).toBeInTheDocument();
  });
});

describe('OutrankedKeywordsSection — empty + placeholder states', () => {
  it('renders a friendly empty message when no keywords are outranked', () => {
    render(
      <OutrankedKeywordsSection
        rollup={buildRollup([])}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/Maintain current investment/i),
    ).toBeInTheDocument();
  });

  it('returns null when rollup is null', () => {
    expectRendersNothing(<OutrankedKeywordsSection rollup={null} loading={false} error={null} />);
  });

  it('renders loading placeholder when loading is true', () => {
    render(
      <OutrankedKeywordsSection rollup={null} loading error={null} />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(
      <OutrankedKeywordsSection rollup={null} loading={false} error="boom" />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
