import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import { useOnboardingStatus } from './useOnboardingStatus';
import {
  createMockOnboardingApi,
  unconfiguredProvidersPayload,
  emptyBrandPayload,
  noSchedulesPayload,
  noPersonasPayload,
} from './useOnboardingStatus-fixtures';

describe('useOnboardingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when enabled', () => {
    it('returns loading true until all checks resolve', async () => {
      const api = createMockOnboardingApi();
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      expect(result.current.loading).toBe(true);

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('fetches providers, brand config, schedules, and personas exactly once on mount', async () => {
      const api = createMockOnboardingApi();
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const callCounts = [api.fetchProviders, api.fetchBrandConfig, api.fetchSchedules, api.fetchPersonas]
        .map((endpoint) => endpoint.mock.calls.length);
      expect(callCounts).toStrictEqual([1, 1, 1, 1]);
    });

    it('reports all signals configured when every endpoint has data', async () => {
      const api = createMockOnboardingApi();
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toStrictEqual({
        providersConfigured: true,
        brandConfigured: true,
        scheduleConfigured: true,
        personasConfigured: true,
      });
    });
  });

  describe('when disabled', () => {
    it('does not fetch any endpoint', () => {
      const api = createMockOnboardingApi();
      renderHook(() => useOnboardingStatus(false, api));

      expect(api.fetchProviders).not.toHaveBeenCalled();
      expect(api.fetchBrandConfig).not.toHaveBeenCalled();
      expect(api.fetchSchedules).not.toHaveBeenCalled();
      expect(api.fetchPersonas).not.toHaveBeenCalled();
    });

    it('returns null status and loading false', () => {
      const api = createMockOnboardingApi();
      const { result } = renderHook(() => useOnboardingStatus(false, api));

      expect(result.current.status).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('provider signal', () => {
    it('reports providersConfigured false when no provider has an API key', async () => {
      const api = createMockOnboardingApi({ providersResponse: unconfiguredProvidersPayload });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.providersConfigured).toBe(false);
    });

    it('reports providersConfigured false when the request fails', async () => {
      const api = createMockOnboardingApi({ shouldFailProviders: true });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.providersConfigured).toBe(false);
    });
  });

  describe('brand signal', () => {
    it('reports brandConfigured false when no first-party brands are tracked', async () => {
      const api = createMockOnboardingApi({ brandConfigResponse: emptyBrandPayload });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.brandConfigured).toBe(false);
    });

    it('reports brandConfigured false when the request fails', async () => {
      const api = createMockOnboardingApi({ shouldFailBrandConfig: true });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.brandConfigured).toBe(false);
    });
  });

  describe('schedule signal', () => {
    it('reports scheduleConfigured false when no schedules exist', async () => {
      const api = createMockOnboardingApi({ schedulesResponse: noSchedulesPayload });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.scheduleConfigured).toBe(false);
    });

    it('reports scheduleConfigured false when the request fails', async () => {
      const api = createMockOnboardingApi({ shouldFailSchedules: true });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.scheduleConfigured).toBe(false);
    });
  });

  describe('personas signal', () => {
    it('reports personasConfigured false when no personas exist', async () => {
      const api = createMockOnboardingApi({ personasResponse: noPersonasPayload });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.personasConfigured).toBe(false);
    });

    it('reports personasConfigured false when the request fails', async () => {
      const api = createMockOnboardingApi({ shouldFailPersonas: true });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status?.personasConfigured).toBe(false);
    });
  });

  describe('partial failures', () => {
    it('keeps healthy signals when one endpoint fails', async () => {
      const api = createMockOnboardingApi({ shouldFailProviders: true });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toStrictEqual({
        providersConfigured: false,
        brandConfigured: true,
        scheduleConfigured: true,
        personasConfigured: true,
      });
    });

    it('reports every signal false when all endpoints fail', async () => {
      const api = createMockOnboardingApi({
        shouldFailProviders: true,
        shouldFailBrandConfig: true,
        shouldFailSchedules: true,
        shouldFailPersonas: true,
      });
      const { result } = renderHook(() => useOnboardingStatus(true, api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toStrictEqual({
        providersConfigured: false,
        brandConfigured: false,
        scheduleConfigured: false,
        personasConfigured: false,
      });
    });
  });
});
