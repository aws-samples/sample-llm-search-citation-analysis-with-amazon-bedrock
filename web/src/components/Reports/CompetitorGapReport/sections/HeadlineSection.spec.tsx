import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { HeadlineSection } from './HeadlineSection';
import {
  buildOutrankedKeyword, buildSource, loadedRollup
} from './rollupSection-fixtures';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

function renderHeadline(props: Partial<ComponentProps<typeof HeadlineSection>>) {
  return render(
    <HeadlineSection
      competitor="Adidas"
      rollup={null}
      keywordsAnalyzed={20}
      loading={false}
      error={null}
      {...props}
    />,
  );
}

describe('HeadlineSection — count derivation', () => {
  it('renders the outranked-keyword count from the rollup', () => {
    renderHeadline(loadedRollup({
      outranked_keywords: [
        buildOutrankedKeyword({ keyword: 'a' }),
        buildOutrankedKeyword({
          keyword: 'b',
          their_best_rank: 2,
          our_best_rank: 5,
          rank_delta: 3,
          providers: ['perplexity'],
        }),
      ],
    }));
    const label = screen.getByText('Outranked keywords').parentElement;
    expect(label).toHaveTextContent('2');
  });

  it('renders the exclusive-source count from the rollup', () => {
    renderHeadline(loadedRollup({
      exclusive_source_count: 37,
      outreach_targets: [buildSource({ priority: 'high' })],
    }));
    const label = screen.getByText('Exclusive sources').parentElement;
    expect(label).toHaveTextContent('37');
  });

  it('renders the high-priority source count for the high-lift metric', () => {
    renderHeadline(loadedRollup({
      exclusive_source_count: 37,
      high_priority_source_count: 12,
      outreach_targets: [buildSource({ priority: 'high' }), buildSource({ priority: 'medium' })],
    }));
    const label = screen.getByText('High-lift targets').parentElement;
    expect(label).toHaveTextContent('12');
  });

  it('renders the keywords-analyzed count in the subhead', () => {
    renderHeadline({
      ...loadedRollup(),
      keywordsAnalyzed: 42,
    });
    expect(screen.getByText(/Across 42 tracked keywords/)).toBeInTheDocument();
  });
});

describe('HeadlineSection — placeholder states', () => {
  it.each(sectionPlaceholderCases(/Loading rollup/i))('renders $name', ({
    state, text
  }) => {
    renderHeadline({
      keywordsAnalyzed: 0,
      ...state,
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders empty state when no rollup data and not loading', () => {
    renderHeadline({ keywordsAnalyzed: 0 });
    expect(screen.getByText(/Run an analysis/i)).toBeInTheDocument();
  });
});
