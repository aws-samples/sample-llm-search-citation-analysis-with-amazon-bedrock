/**
 * Support for the SEO home spec. The spec mocks `api/seo` and
 * `useProviderConfig`; `renderHomeWith` points them at a setup state.
 */
import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { isSeoApiConfigured } from '../../api/seo';
import {
  useProviderConfig, type ProviderConfig
} from '../../hooks/useProviderConfig';
import {
  SEO_SETUP_TITLE, SeoHome
} from './SeoHome';

interface SetupState {
  /** The SEO API URL was built into the dashboard. */
  readonly deployed: boolean;
  /** A DataForSEO login is stored. */
  readonly keyStored: boolean;
  readonly providersLoading?: boolean;
}

function dataForSeoProvider(configured: boolean): ProviderConfig {
  return {
    id: 'dataforseo',
    name: 'DataForSEO',
    description: 'Keyword data and Google results pages',
    model: '',
    docs_url: 'https://app.dataforseo.com/api-access',
    enabled: true,
    configured,
    masked_key: configured ? 'login@example.com' : null,
    last_updated: null,
  };
}

/** The SEO home inside a router, with the SEO stack and the DataForSEO login as `state` says. */
export function renderHomeWith(state: SetupState) {
  vi.mocked(isSeoApiConfigured).mockReturnValue(state.deployed);
  vi.mocked(useProviderConfig).mockReturnValue({
    providers: [dataForSeoProvider(state.keyStored)],
    loading: state.providersLoading ?? false,
    error: null,
    refreshProviders: vi.fn(),
    updateProvider: vi.fn(),
  });
  return render(<MemoryRouter><SeoHome /></MemoryRouter>);
}

/** The "Set up SEO data" panel's heading, or null when the panel is not shown. */
export function querySetupHeadingElement(): HTMLElement | null {
  return screen.queryByRole('heading', { name: SEO_SETUP_TITLE });
}
