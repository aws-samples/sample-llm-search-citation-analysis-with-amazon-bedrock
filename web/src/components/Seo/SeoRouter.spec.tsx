import { SeoRouter } from './SeoRouter';
import { renderRouterAt } from './SeoRouter-fixtures';
import {
  describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('../../api/seo', () => import('../../test/seoApiMock'));
vi.mock('./seoPages', async (importOriginal) => ({
  ...await importOriginal<typeof import('./seoPages')>(),
  SEO_PAGES: (await import('./SeoRouter-fixtures')).FAKE_SEO_PAGES,
}));

describe('SeoRouter', () => {
  it('shows the SEO home when /seo is opened', async () => {
    renderRouterAt(<SeoRouter />, '/seo');

    expect(await screen.findByRole('heading', { name: 'SEO' })).toBeInTheDocument();
  });

  it('loads the page of the slug when a deep link is opened', async () => {
    renderRouterAt(<SeoRouter />, '/seo/backlinks');

    expect(await screen.findByText('Backlinks page')).toBeInTheDocument();
  });

  it('redirects an unknown SEO path to the SEO home', async () => {
    renderRouterAt(<SeoRouter />, '/seo/no-such-page');

    await screen.findByRole('heading', { name: 'SEO' });
    expect(screen.getByRole('status', { name: 'Current path' })).toHaveTextContent(/^\/seo$/);
  });
});
