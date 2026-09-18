import { expect } from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import { createMockEndpoint } from './injectableApi-fixtures';
import {
  useOnboardingStatus, type OnboardingStatusApi 
} from './useOnboardingStatus';

export interface OnboardingMockApiOptions {
  providersResponse?: unknown;
  brandConfigResponse?: unknown;
  schedulesResponse?: unknown;
  personasResponse?: unknown;
  shouldFailProviders?: boolean;
  shouldFailBrandConfig?: boolean;
  shouldFailSchedules?: boolean;
  shouldFailPersonas?: boolean;
}

/** Providers payload with one configured provider (the happy default). */
const configuredProvidersPayload = {
  providers: [
    {
      id: 'openai',
      configured: true,
      enabled: true, 
    },
    {
      id: 'perplexity',
      configured: false,
      enabled: false, 
    },
  ],
};

/** Providers payload where no provider has an API key yet. */
export const unconfiguredProvidersPayload = {
  providers: [
    {
      id: 'openai',
      configured: false,
      enabled: false, 
    },
  ],
};

/** Brand config payload with tracked first-party brands. */
const configuredBrandPayload = {
  industry: 'hospitality',
  tracked_brands: {
    first_party: ['MyHotel'],
    competitors: ['Marriott'],
  },
};

/** Brand config payload as synthesized by the API for a fresh install. */
export const emptyBrandPayload = {
  industry: 'hotels',
  tracked_brands: {
    first_party: [],
    competitors: [],
  },
};

/** Schedules payload with one existing schedule. */
const withSchedulesPayload = {
  schedules: [
    {
      name: 'daily-analysis',
      state: 'ENABLED',
      schedule: 'cron(0 9 * * ? *)',
      timezone: 'UTC',
    },
  ],
};

/** Schedules payload for a fresh install. */
export const noSchedulesPayload = { schedules: [] };

/** Personas payload (raw array) with one configured persona. */
const withPersonasPayload = [
  {
    id: 'prompt-1',
    name: 'Family Traveler',
    template: 'As a family traveler, find {keyword}',
    enabled: 'true',
  },
];

/** Personas payload for a fresh install. */
export const noPersonasPayload: unknown[] = [];

function createMockOnboardingApi(options: OnboardingMockApiOptions = {}) {
  return {
    fetchProviders: createMockEndpoint(
      options.shouldFailProviders,
      options.providersResponse ?? configuredProvidersPayload
    ),
    fetchBrandConfig: createMockEndpoint(
      options.shouldFailBrandConfig,
      options.brandConfigResponse ?? configuredBrandPayload
    ),
    fetchSchedules: createMockEndpoint(
      options.shouldFailSchedules,
      options.schedulesResponse ?? withSchedulesPayload
    ),
    fetchPersonas: createMockEndpoint(
      options.shouldFailPersonas,
      options.personasResponse ?? withPersonasPayload
    ),
  } satisfies OnboardingStatusApi;
}

/** Renders the hook against a mocked API without waiting for the checks to settle. */
export function renderOnboardingStatus(enabled: boolean, options: OnboardingMockApiOptions = {}) {
  const api = createMockOnboardingApi(options);
  const { result } = renderHook(() => useOnboardingStatus(enabled, api));
  return {
    api,
    result,
  };
}

/** Renders the enabled hook and waits until every setup check has resolved. */
export async function renderLoadedOnboardingStatus(options: OnboardingMockApiOptions = {}) {
  const rendered = renderOnboardingStatus(true, options);
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}
