import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { HeadlineSection } from './HeadlineSection';
import {
  buildRollup, buildSource
} from './HeadlineSection-fixtures';

describe('HeadlineSection — count derivation', () => {
  it('renders the outranked-keyword count from the rollup', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={buildRollup({
          outranked_keywords: [
            {
              keyword: 'a',
              their_best_rank: 1,
              our_best_rank: 3,
              rank_delta: 2,
              providers: ['openai'],
            },
            {
              keyword: 'b',
              their_best_rank: 2,
              our_best_rank: 5,
              rank_delta: 3,
              providers: ['perplexity'],
            },
          ],
        })}
        keywordsAnalyzed={20}
        loading={false}
        error={null}
      />,
    );
    const label = screen.getByText('Outranked keywords').parentElement;
    expect(label).toHaveTextContent('2');
  });

  it('renders the exclusive-source count from the rollup', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={buildRollup({exclusive_sources: [buildSource('high'), buildSource('medium')],})}
        keywordsAnalyzed={20}
        loading={false}
        error={null}
      />,
    );
    const label = screen.getByText('Exclusive sources').parentElement;
    expect(label).toHaveTextContent('2');
  });

  it('counts only high-priority sources for the high-lift metric', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={buildRollup({
          exclusive_sources: [
            buildSource('high'),
            buildSource('high'),
            buildSource('medium'),
            buildSource('low'),
          ],
        })}
        keywordsAnalyzed={20}
        loading={false}
        error={null}
      />,
    );
    const label = screen.getByText('High-lift targets').parentElement;
    expect(label).toHaveTextContent('2');
  });

  it('renders the keywords-analyzed count in the subhead', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={buildRollup()}
        keywordsAnalyzed={42}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Across 42 tracked keywords/)).toBeInTheDocument();
  });
});

describe('HeadlineSection — placeholder states', () => {
  it('renders loading placeholder when loading is true', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={null}
        keywordsAnalyzed={0}
        loading
        error={null}
      />,
    );
    expect(screen.getByText(/Loading rollup/i)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={null}
        keywordsAnalyzed={0}
        loading={false}
        error="boom"
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders empty state when no rollup data and not loading', () => {
    render(
      <HeadlineSection
        competitor="Adidas"
        rollup={null}
        keywordsAnalyzed={0}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Run an analysis/i)).toBeInTheDocument();
  });
});
