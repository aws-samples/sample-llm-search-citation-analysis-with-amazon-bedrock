import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ContentIdea } from '../../../../types';
import type { SectionFetchState } from '../../layout';
import { SuggestedBriefsSection } from './SuggestedBriefsSection';
import {
  buildIdea, fetchPlaceholderCases
} from './ContentPlanSectionProps-fixtures';

function renderIdeas(
  ideas: ReadonlyArray<ContentIdea>,
  state: SectionFetchState = {
    loading: false,
    error: null,
  },
) {
  return render(<SuggestedBriefsSection ideas={ideas} {...state} />);
}

describe('SuggestedBriefsSection', () => {
  it('orders ideas high priority first, then medium, then low', () => {
    renderIdeas([
      buildIdea('Low pri', { priority: 'low' }),
      buildIdea('High pri', { priority: 'high' }),
      buildIdea('Medium pri', { priority: 'medium' }),
    ]);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toStrictEqual(['High pri', 'Medium pri', 'Low pri']);
  });

  it('caps the rendered list at 10 ideas', () => {
    renderIdeas(Array.from({ length: 15 }, (_, i) => buildIdea(`Idea ${i}`, { priority: 'medium' })));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(10);
  });

  it('renders the empty state when there are no ideas', () => {
    renderIdeas([]);
    expect(
      screen.getByText(/No open content ideas right now/i),
    ).toBeInTheDocument();
  });

  it.each(fetchPlaceholderCases(/Loading content ideas/i))('renders the $name', ({
    state, text
  }) => {
    renderIdeas([], state);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
