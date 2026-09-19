import {
  describe, it, expect 
} from 'vitest';
import { waitFor } from '@testing-library/react';
import type { OnboardingSetupStatus } from './useOnboardingStatus';
import {
  type OnboardingMockApiOptions,
  renderLoadedOnboardingStatus,
  renderOnboardingStatus,
  unconfiguredProvidersPayload,
  emptyBrandPayload,
  noSchedulesPayload,
  noPersonasPayload,
} from './useOnboardingStatus-fixtures';

const fullyConfiguredStatus: OnboardingSetupStatus = {
  providersConfigured: true,
  brandConfigured: true,
  scheduleConfigured: true,
  personasConfigured: true,
};

describe('useOnboardingStatus', () => {
  describe('when enabled', () => {
    it('returns loading true until all checks resolve', async () => {
      const { result } = renderOnboardingStatus(true);

      expect(result.current.loading).toBe(true);

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('fetches providers, brand config, schedules, and personas exactly once on mount', async () => {
      const { api } = await renderLoadedOnboardingStatus();

      const callCounts = [api.fetchProviders, api.fetchBrandConfig, api.fetchSchedules, api.fetchPersonas]
        .map((endpoint) => endpoint.mock.calls.length);
      expect(callCounts).toStrictEqual([1, 1, 1, 1]);
    });

    it('reports all signals configured when every endpoint has data', async () => {
      const { result } = await renderLoadedOnboardingStatus();

      expect(result.current.status).toStrictEqual(fullyConfiguredStatus);
    });
  });

  describe('when disabled', () => {
    it('does not fetch any endpoint', () => {
      const { api } = renderOnboardingStatus(false);

      expect(api.fetchProviders).not.toHaveBeenCalled();
      expect(api.fetchBrandConfig).not.toHaveBeenCalled();
      expect(api.fetchSchedules).not.toHaveBeenCalled();
      expect(api.fetchPersonas).not.toHaveBeenCalled();
    });

    it('returns null status and loading false', () => {
      const { result } = renderOnboardingStatus(false);

      expect(result.current.status).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('individual signals', () => {
    interface SignalCase {
      signal: keyof OnboardingSetupStatus;
      condition: string;
      apiOptions: OnboardingMockApiOptions;
    }

    const signalCases: SignalCase[] = [
      {
        signal: 'providersConfigured',
        condition: 'no provider has an API key',
        apiOptions: { providersResponse: unconfiguredProvidersPayload },
      },
      {
        signal: 'providersConfigured',
        condition: 'the providers request fails',
        apiOptions: { shouldFailProviders: true },
      },
      {
        signal: 'brandConfigured',
        condition: 'no first-party brands are tracked',
        apiOptions: { brandConfigResponse: emptyBrandPayload },
      },
      {
        signal: 'brandConfigured',
        condition: 'the brand config request fails',
        apiOptions: { shouldFailBrandConfig: true },
      },
      {
        signal: 'scheduleConfigured',
        condition: 'no schedules exist',
        apiOptions: { schedulesResponse: noSchedulesPayload },
      },
      {
        signal: 'scheduleConfigured',
        condition: 'the schedules request fails',
        apiOptions: { shouldFailSchedules: true },
      },
      {
        signal: 'personasConfigured',
        condition: 'no personas exist',
        apiOptions: { personasResponse: noPersonasPayload },
      },
      {
        signal: 'personasConfigured',
        condition: 'the personas request fails',
        apiOptions: { shouldFailPersonas: true },
      },
    ];

    it.each(signalCases)('reports only $signal false when $condition', async ({
      signal, apiOptions 
    }) => {
      const { result } = await renderLoadedOnboardingStatus(apiOptions);

      expect(result.current.status).toStrictEqual({
        ...fullyConfiguredStatus,
        [signal]: false,
      });
    });
  });

  describe('partial failures', () => {
    it('keeps healthy signals when one endpoint fails', async () => {
      const { result } = await renderLoadedOnboardingStatus({ shouldFailProviders: true });

      expect(result.current.status).toStrictEqual({
        providersConfigured: false,
        brandConfigured: true,
        scheduleConfigured: true,
        personasConfigured: true,
      });
    });

    it('reports every signal false when all endpoints fail', async () => {
      const { result } = await renderLoadedOnboardingStatus({
        shouldFailProviders: true,
        shouldFailBrandConfig: true,
        shouldFailSchedules: true,
        shouldFailPersonas: true,
      });

      expect(result.current.status).toStrictEqual({
        providersConfigured: false,
        brandConfigured: false,
        scheduleConfigured: false,
        personasConfigured: false,
      });
    });
  });
});
