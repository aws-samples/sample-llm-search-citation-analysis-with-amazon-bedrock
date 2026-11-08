import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SeeAllLink } from './SeeAllLink';

describe('SeeAllLink', () => {
  it('points at the full view inside the app router', () => {
    render(<MemoryRouter><SeeAllLink to="/citation-gaps">See all citation gaps</SeeAllLink></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'See all citation gaps' })).toHaveAttribute('href', '/citation-gaps');
  });

  it('points at the full view without a router', () => {
    render(<SeeAllLink to="/content-studio">See all content ideas</SeeAllLink>);

    expect(screen.getByRole('link', { name: 'See all content ideas' })).toHaveAttribute('href', '/content-studio');
  });

  it('is hidden from the printed page', () => {
    render(<SeeAllLink to="#brand-leaderboard">See all brands</SeeAllLink>);

    expect(screen.getByRole('link', { name: 'See all brands' })).toHaveClass('print-hidden');
  });
});
