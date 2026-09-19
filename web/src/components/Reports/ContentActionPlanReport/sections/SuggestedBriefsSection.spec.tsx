import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { SuggestedBriefsSection } from './SuggestedBriefsSection';
import { buildIdea } from './SuggestedBriefsSection-fixtures';

describe('SuggestedBriefsSection', () => {
  it('orders ideas high priority first, then medium, then low', () => {
    const ideas = [
      buildIdea('i1', 'low', 'Low pri'),
      buildIdea('i2', 'high', 'High pri'),
      buildIdea('i3', 'medium', 'Medium pri'),
    ];
    render(<SuggestedBriefsSection ideas={ideas} loading={false} error={null} />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toStrictEqual(['High pri', 'Medium pri', 'Low pri']);
  });

  it('caps the rendered list at 10 ideas', () => {
    const ideas = Array.from({ length: 15 }, (_, i) =>
      buildIdea(`i${i}`, 'medium', `Idea ${i}`),
    );
    render(<SuggestedBriefsSection ideas={ideas} loading={false} error={null} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(10);
  });

  it('renders the empty state when there are no ideas', () => {
    render(<SuggestedBriefsSection ideas={[]} loading={false} error={null} />);
    expect(
      screen.getByText(/No open content ideas right now/i),
    ).toBeInTheDocument();
  });

  it('renders the loading placeholder when loading is true', () => {
    render(<SuggestedBriefsSection ideas={[]} loading error={null} />);
    expect(screen.getByText(/Loading content ideas/i)).toBeInTheDocument();
  });

  it('renders the error placeholder when error is set', () => {
    render(<SuggestedBriefsSection ideas={[]} loading={false} error="Backend down" />);
    expect(screen.getByText(/Backend down/i)).toBeInTheDocument();
  });
});
