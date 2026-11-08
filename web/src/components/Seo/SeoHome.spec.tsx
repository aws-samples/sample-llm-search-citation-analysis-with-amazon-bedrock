import {
  describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import {
  querySetupHeadingElement, renderHomeWith
} from './SeoHome-fixtures';

vi.mock('../../api/seo', () => import('../../test/seoApiMock'));
vi.mock('../../hooks/useProviderConfig', () => ({ useProviderConfig: vi.fn() }));

const READY = {
  deployed: true,
  keyStored: true,
} as const;

describe('SeoHome', () => {
  it('links every SEO page to its path', () => {
    renderHomeWith(READY);

    expect(screen.getByRole('link', { name: /^Domain Overview/ })).toHaveAttribute('href', '/seo/domain');
    expect(screen.getByRole('link', { name: /^Site Audit/ })).toHaveAttribute('href', '/seo/site-audit');
  });

  it('links the Keyword Explorer and the SEO vs GEO report', () => {
    renderHomeWith(READY);

    expect(screen.getByRole('link', { name: /^Keyword Explorer/ })).toHaveAttribute('href', '/keyword-research');
    expect(screen.getByRole('link', { name: /^SEO vs GEO report/ })).toHaveAttribute('href', '/reports/seo-geo');
  });

  it('shows no setup panel when the stack is deployed and DataForSEO has a login', () => {
    renderHomeWith(READY);

    expect(querySetupHeadingElement()).not.toBeInTheDocument();
  });

  it('asks to deploy the SEO stack when its API URL is missing', () => {
    renderHomeWith({
      deployed: false,
      keyStored: false,
    });

    expect(screen.getByText(/The SEO stack is not deployed/)).toBeInTheDocument();
  });

  it('points to Settings › AI Providers when DataForSEO has no login', () => {
    renderHomeWith({
      deployed: true,
      keyStored: false,
    });

    expect(screen.getByRole('link', { name: 'Settings › AI Providers' })).toHaveAttribute('href', '/settings/providers');
  });

  it('shows no setup panel while the providers are loading', () => {
    renderHomeWith({
      deployed: true,
      keyStored: false,
      providersLoading: true,
    });

    expect(querySetupHeadingElement()).not.toBeInTheDocument();
  });
});
