import { vi } from 'vitest';

/** Providers payload with one configured provider (the happy default). */
export const configuredProvidersPayload = {
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
export const configuredBrandPayload = {
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
export const withSchedulesPayload = {
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
export const withPersonasPayload = [
  {
    id: 'prompt-1',
    name: 'Family Traveler',
    template: 'As a family traveler, find {keyword}',
    enabled: 'true',
  },
];

/** Personas payload for a fresh install. */
export const noPersonasPayload: unknown[] = [];

export function createMockOnboardingApi(options: {
  providersResponse?: unknown;
  brandConfigResponse?: unknown;
  schedulesResponse?: unknown;
  personasResponse?: unknown;
  shouldFailProviders?: boolean;
  shouldFailBrandConfig?: boolean;
  shouldFailSchedules?: boolean;
  shouldFailPersonas?: boolean;
} = {}) {
  return {
    fetchProviders: vi.fn().mockImplementation(() => {
      if (options.shouldFailProviders) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.providersResponse ?? configuredProvidersPayload),
      });
    }),
    fetchBrandConfig: vi.fn().mockImplementation(() => {
      if (options.shouldFailBrandConfig) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.brandConfigResponse ?? configuredBrandPayload),
      });
    }),
    fetchSchedules: vi.fn().mockImplementation(() => {
      if (options.shouldFailSchedules) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.schedulesResponse ?? withSchedulesPayload),
      });
    }),
    fetchPersonas: vi.fn().mockImplementation(() => {
      if (options.shouldFailPersonas) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.personasResponse ?? withPersonasPayload),
      });
    }),
  };
}
