import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SeoDashboardCards } from './SeoDashboardCards';

/** The dashboard's SEO cards inside a router (they link to other pages). */
export function renderSeoCards() {
  return render(<MemoryRouter><SeoDashboardCards /></MemoryRouter>);
}

/** The card titled `title`. */
export function getCardElement(title: 'SEO vs GEO' | 'Rankings'): HTMLElement {
  return screen.getByRole('region', { name: title });
}
