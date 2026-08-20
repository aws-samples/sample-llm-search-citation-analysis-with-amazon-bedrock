import {
  useMemo, useState 
} from 'react';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { findUnhealthyProviders } from '../../formatting/providerHealth';

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
      <svg className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>

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
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
