import {
  useState, useEffect 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';

/**
 * Setup signals that require an API round-trip. Signals that are already
 * available in app state (keyword count, execution history) are passed to the
 * onboarding UI directly and are intentionally not fetched here.
 */
export interface OnboardingSetupStatus {
  /** At least one AI provider has an API key stored in Secrets Manager. */
  providersConfigured: boolean;
  /** At least one first-party brand is tracked in the brand config. */
  brandConfigured: boolean;
  /** At least one automated schedule exists. */
  scheduleConfigured: boolean;
}

/** API functions for onboarding status - injectable for testing */
export interface OnboardingStatusApi {
  fetchProviders: () => Promise<Response>;
  fetchBrandConfig: () => Promise<Response>;
  fetchSchedules: () => Promise<Response>;
}

/** Default API implementation using authenticatedFetch */
export const defaultOnboardingStatusApi: OnboardingStatusApi = {
  fetchProviders: () => authenticatedFetch(`${API_BASE_URL}/providers`),
  fetchBrandConfig: () => authenticatedFetch(`${API_BASE_URL}/brand-config`),
  fetchSchedules: () => authenticatedFetch(`${API_BASE_URL}/schedules`),
};

interface ProvidersPayload {providers?: { configured?: boolean }[];}

interface BrandConfigPayload {tracked_brands?: { first_party?: string[] };}

interface SchedulesPayload {schedules?: unknown[];}

function isPayload(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

async function readProvidersConfigured(api: OnboardingStatusApi): Promise<boolean> {
  const response = await api.fetchProviders();
  if (!response.ok) return false;
  const data: unknown = await response.json();
  if (!isPayload(data)) return false;
  const payload: ProvidersPayload = data;
  return (payload.providers ?? []).some((provider) => provider.configured === true);
}

async function readBrandConfigured(api: OnboardingStatusApi): Promise<boolean> {
  const response = await api.fetchBrandConfig();
  if (!response.ok) return false;
  const data: unknown = await response.json();
  if (!isPayload(data)) return false;
  // GET /brand-config never 404s: it synthesizes a default config with empty
  // tracked_brands when nothing is stored, so presence of first-party brands
  // is the only reliable "configured" signal.
  const payload: BrandConfigPayload = data;
  return (payload.tracked_brands?.first_party ?? []).length > 0;
}

async function readScheduleConfigured(api: OnboardingStatusApi): Promise<boolean> {
  const response = await api.fetchSchedules();
  if (!response.ok) return false;
  const data: unknown = await response.json();
  if (!isPayload(data)) return false;
  const payload: SchedulesPayload = data;
  return (payload.schedules ?? []).length > 0;
}

/** Treat any request failure as "not configured" - the safe onboarding default. */
async function safeCheck(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

interface UseOnboardingStatusReturn {
  status: OnboardingSetupStatus | null;
  loading: boolean;
}

/**
 * Hook that composes the remote setup signals needed by the onboarding
 * checklist. There is no aggregated setup-status endpoint, so this fans out to
 * the providers, brand-config, and schedules endpoints in parallel.
 *
 * @param enabled - When false (e.g. onboarding was dismissed) nothing is
 *                  fetched and `status` stays null.
 * @param api - Optional API implementation for testing
 */
export function useOnboardingStatus(
  enabled: boolean,
  api: OnboardingStatusApi = defaultOnboardingStatusApi
): UseOnboardingStatusReturn {
  const [status, setStatus] = useState<OnboardingSetupStatus | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();

    const loadStatus = async () => {
      setLoading(true);
      const [providersConfigured, brandConfigured, scheduleConfigured] = await Promise.all([
        safeCheck(() => readProvidersConfigured(api)),
        safeCheck(() => readBrandConfigured(api)),
        safeCheck(() => readScheduleConfigured(api)),
      ]);
      if (!controller.signal.aborted) {
        setStatus({
          providersConfigured,
          brandConfigured,
          scheduleConfigured, 
        });
        setLoading(false);
      }
    };
    loadStatus();

    return () => controller.abort();
  }, [enabled, api]);

  return {
    status,
    loading, 
  };
}
