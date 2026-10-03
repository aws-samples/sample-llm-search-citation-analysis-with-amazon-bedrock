import type { ComponentProps } from 'react';
import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { RecommendationsSection } from './RecommendationsSection';
import {
  buildRecommendation, buildRecResponse
} from './RecommendationsSection-fixtures';
import type { Recommendation } from '../../../../types';

const KEYWORD_SCOPED = buildRecommendation('Pitch outdoor publishers', { keywords: ['best running shoes (rank 3)'] });

const OTHER_KEYWORD_SCOPED = buildRecommendation('Different keyword item', { keywords: ['best hiking boots'] });

const GLOBAL_REC = buildRecommendation('Add Spanish brand variants', {
  type: 'config',
  priority: 'medium',
});

const LOW_PRIORITY_SCOPED = buildRecommendation('Update product page copy', {
  type: 'content',
  priority: 'low',
  keywords: ['best running shoes'],
});

type SectionProps = ComponentProps<typeof RecommendationsSection>;

/** The section for 'best running shoes', loaded with `recommendations` (none fetched when null), unless `props` say otherwise. */
function renderRecommendations(recommendations: Recommendation[] | null, props: Partial<Omit<SectionProps, 'recommendations'>> = {}) {
  render(
    <RecommendationsSection
      recommendations={recommendations === null ? null : buildRecResponse(recommendations)}
      keyword="best running shoes"
      loading={false}
      error={null}
      {...props}
    />,
  );
}

describe('RecommendationsSection — filtering', () => {
  it('renders recommendations whose keywords array matches the report keyword', () => {
    renderRecommendations([KEYWORD_SCOPED]);

    expect(screen.getByText('Pitch outdoor publishers')).toBeInTheDocument();
  });

  it('hides recommendations scoped to a different keyword', () => {
    renderRecommendations([OTHER_KEYWORD_SCOPED]);

    expect(screen.queryByText('Different keyword item')).not.toBeInTheDocument();
  });

  it('always includes recommendations with no keywords array (global)', () => {
    renderRecommendations([GLOBAL_REC]);

    expect(screen.getByText('Add Spanish brand variants')).toBeInTheDocument();
  });

  it('matches even when the keywords entry has trailing rank annotation', () => {
    // Real API output: "best running shoes (rank 3)" — the section uses a
    // case-insensitive substring match so this should still fire.
    renderRecommendations([KEYWORD_SCOPED], { keyword: 'BEST RUNNING SHOES' });

    expect(screen.getByText('Pitch outdoor publishers')).toBeInTheDocument();
  });
});

describe('RecommendationsSection — ordering and empty states', () => {
  it('orders matched recommendations by priority high -> medium -> low', () => {
    renderRecommendations([LOW_PRIORITY_SCOPED, KEYWORD_SCOPED, GLOBAL_REC]);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Pitch outdoor publishers');
    expect(items[1]).toHaveTextContent('Add Spanish brand variants');
    expect(items[2]).toHaveTextContent('Update product page copy');
  });

  it('renders the empty state when no recommendations exist at all', () => {
    renderRecommendations([]);

    expect(screen.getByText(/No recommendations generated yet/i)).toBeInTheDocument();
  });

  it('renders the keyword-specific empty state when global list is non-empty but nothing matches', () => {
    renderRecommendations([OTHER_KEYWORD_SCOPED]);

    expect(screen.getByText(/none reference/i)).toBeInTheDocument();
  });

  it('renders the loading placeholder when loading is true', () => {
    renderRecommendations(null, { loading: true });

    expect(screen.getByText(/Loading recommendations/i)).toBeInTheDocument();
  });

  it('renders the error placeholder when error is set', () => {
    renderRecommendations(null, { error: 'Network down' });

    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
