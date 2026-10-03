import {
  useMemo, useState 
} from 'react';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { findUnhealthyProviders } from '../../formatting/providerHealth';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CLOSE_PATHS, EXCLAMATION_TRIANGLE_PATHS 
} from '../ui/iconPaths';

/**
 * Dismissal is deliberately session-scoped: a provider that is out of credit
 * stays out of credit, so the warning must come back on the next visit, but
 * nagging on every tab change within one sitting is what gets banners ignored.
 */
export const PROVIDER_HEALTH_DISMISSED_STORAGE_KEY = 'provider-health-dismissed';

function readDismissedFlag(): boolean {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY) === 'true';
  }
  return false;
}

interface ProviderHealthBannerProps {
  /** Opens Settings on the AI Providers tab, where the fix lives. */
  readonly onNavigateToProviders: () => void;
}

/**
 * App-wide warning for providers that have stopped returning results.
 *
 * Mounted once in `App` rather than per view, so an outage is visible from
 * whichever tab the user happens to be on. It reads the same
 * `useProviderConfig` fetch the Settings panel uses — there is no polling loop
 * to piggyback on, and none is added here: provider health changes on the
 * timescale of analysis runs, so the load-time snapshot is enough.
 */
export const ProviderHealthBanner = ({ onNavigateToProviders }: ProviderHealthBannerProps) => {
  const {
    providers, loading 
  } = useProviderConfig();
  const [dismissed, setDismissed] = useState(readDismissedFlag);

  const unhealthy = useMemo(() => findUnhealthyProviders(providers), [providers]);

  if (loading || dismissed || unhealthy.length === 0) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY, 'true');
    setDismissed(true);
  };

  const headline = unhealthy.length === 1
    ? '1 AI provider is not returning results'
    : `${unhealthy.length} AI providers are not returning results`;

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <StrokeIcon className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" paths={EXCLAMATION_TRIANGLE_PATHS} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">{headline}</p>
        <ul className="mt-1 space-y-0.5">
          {unhealthy.map((provider) => (
            <li key={provider.id} className="text-sm text-amber-800">{provider.summary}</li>
          ))}
        </ul>
        <button
          onClick={() => onNavigateToProviders()}
          className="mt-2 text-sm font-medium text-amber-900 underline hover:text-amber-950"
        >
          Review AI provider settings
        </button>
      </div>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss provider warning"
        className="p-1 -mt-1 -mr-1 shrink-0 text-amber-600 hover:text-amber-900 hover:bg-amber-100 rounded transition-colors"
      >
        <StrokeIcon className="w-4 h-4" paths={CLOSE_PATHS} />
      </button>
    </div>
  );
};
