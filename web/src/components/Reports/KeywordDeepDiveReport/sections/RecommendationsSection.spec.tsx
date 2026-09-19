import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { RecommendationsSection } from './RecommendationsSection';
import { buildRecResponse } from './RecommendationsSection-fixtures';
import type { Recommendation } from '../../../../types';

const KEYWORD_SCOPED: Recommendation = {
  type: 'gap',
  priority: 'high',
  title: 'Pitch outdoor publishers',
  description: 'd',
  action: 'a',
  impact: 'i',
  keywords: ['best running shoes (rank 3)'],
};

const OTHER_KEYWORD_SCOPED: Recommendation = {
  type: 'gap',
  priority: 'high',
  title: 'Different keyword item',
  description: 'd',
  action: 'a',
  impact: 'i',
  keywords: ['best hiking boots'],
};

const GLOBAL_REC: Recommendation = {
  type: 'config',
  priority: 'medium',
  title: 'Add Spanish brand variants',
  description: 'd',
  action: 'a',
  impact: 'i',
  // No keywords array => global, always included.
};

const LOW_PRIORITY_SCOPED: Recommendation = {
  type: 'content',
  priority: 'low',
  title: 'Update product page copy',
  description: 'd',
  action: 'a',
  impact: 'i',
  keywords: ['best running shoes'],
};

describe('RecommendationsSection — filtering', () => {
  it('renders recommendations whose keywords array matches the report keyword', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([KEYWORD_SCOPED])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('Pitch outdoor publishers')).toBeInTheDocument();
  });

  it('hides recommendations scoped to a different keyword', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([OTHER_KEYWORD_SCOPED])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByText('Different keyword item'),
    ).not.toBeInTheDocument();
  });

  it('always includes recommendations with no keywords array (global)', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([GLOBAL_REC])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('Add Spanish brand variants')).toBeInTheDocument();
  });

  it('matches even when the keywords entry has trailing rank annotation', () => {
    // Real API output: "best running shoes (rank 3)" — the section uses a
    // case-insensitive substring match so this should still fire.
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([KEYWORD_SCOPED])}
        keyword="BEST RUNNING SHOES"
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('Pitch outdoor publishers')).toBeInTheDocument();
  });
});

describe('RecommendationsSection — ordering and empty states', () => {
  it('orders matched recommendations by priority high -> medium -> low', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([
          LOW_PRIORITY_SCOPED,
          KEYWORD_SCOPED,
          GLOBAL_REC,
        ])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Pitch outdoor publishers');
    expect(items[1]).toHaveTextContent('Add Spanish brand variants');
    expect(items[2]).toHaveTextContent('Update product page copy');
  });

  it('renders the empty state when no recommendations exist at all', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/No recommendations generated yet/i),
    ).toBeInTheDocument();
  });

  it('renders the keyword-specific empty state when global list is non-empty but nothing matches', () => {
    render(
      <RecommendationsSection
        recommendations={buildRecResponse([OTHER_KEYWORD_SCOPED])}
        keyword="best running shoes"
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/none reference/i),
    ).toBeInTheDocument();
  });

  it('renders the loading placeholder when loading is true', () => {
    render(
      <RecommendationsSection
        recommendations={null}
        keyword="best running shoes"
        loading
        error={null}
      />,
    );
    expect(screen.getByText(/Loading recommendations/i)).toBeInTheDocument();
  });

  it('renders the error placeholder when error is set', () => {
    render(
      <RecommendationsSection
        recommendations={null}
        keyword="best running shoes"
        loading={false}
        error="Network down"
      />,
    );
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
