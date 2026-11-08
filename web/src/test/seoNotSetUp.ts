import { screen } from '@testing-library/react';

/** The heading an SEO view shows instead of its content when the SEO API URL was not built in. */
export function getSeoNotSetUpElement(): HTMLElement {
  return screen.getByRole('heading', { name: 'SEO data is not set up' });
}
