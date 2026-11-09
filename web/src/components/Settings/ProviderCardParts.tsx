import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  credentialProviderName, usesIamAuth
} from '../../constants/providers';
import { describeProviderHealth } from '../../formatting/providerHealth';
import type {
  ProviderHealthDescriptor, ProviderHealthTone
} from '../../formatting/providerHealth';
import { formatRelativeTime } from '../../formatting/dateFormatter';
import { StrokeIcon } from '../ui/StrokeIcon';
import { EXCLAMATION_TRIANGLE_PATHS } from '../ui/iconPaths';

/**
 * The pieces of a Settings › AI Providers card: its colours, the status
 * pills and health badge, the auto-disabled note and the enable switch.
 */

export function getProviderDotClass(configured: boolean, enabled: boolean): string {
  if (configured && enabled) return 'bg-emerald-500';
  if (configured) return 'bg-amber-500';
  return 'bg-gray-300';
}

/** "Uses the DataForSEO login": the note of a provider that borrows another one's key. */
export function borrowedCredentialText(source: string): string {
  return `Uses the ${credentialProviderName(source)} login`;
}

function getToggleTitle(provider: ProviderConfig): string {
  if (!provider.configured) {
    if (provider.credential_from !== undefined) return `Add the ${credentialProviderName(provider.credential_from)} login first`;
    return usesIamAuth(provider) ? 'Gateway not deployed: deploy the web search stack to enable this provider' : 'Configure API key first';
  }
  return provider.enabled ? 'Disable' : 'Enable';
}

/**
 * Credit exhaustion and rejected keys stop the provider until someone acts, so
 * they get the loudest treatment; rate limits and timeouts usually clear up on
 * their own.
 */
const HEALTH_TONE_CLASSES: Record<ProviderHealthTone, string> = {
  ok: 'text-emerald-700 bg-gray-50 border-gray-200',
  warning: 'text-amber-800 bg-gray-50 border-gray-200',
  critical: 'text-red-800 bg-red-50 border-red-300 font-semibold',
};

function getHealthTitle(health: ProviderHealthDescriptor): string | undefined {
  return health.tone === 'ok'
    ? `Last successful result ${formatRelativeTime(health.occurredAt)}`
    : health.rawError;
}

interface ProviderHealthProps {readonly provider: ProviderConfig;}

const ProviderHealthBadge = ({ provider }: ProviderHealthProps) => {
  const health = describeProviderHealth(provider);
  if (health === null) return null;

  const showElapsed = health.tone !== 'ok' && health.occurredAt !== undefined;

  return (
    <output
      className={`text-xs px-2 py-1 rounded-sm border ${HEALTH_TONE_CLASSES[health.tone]}`}
      title={getHealthTitle(health)}
    >
      {health.label}
      {showElapsed && (
        <span className="font-normal opacity-75">{` · ${formatRelativeTime(health.occurredAt)}`}</span>
      )}
    </output>
  );
};

/**
 * Spelled out on its own row rather than squeezed into the badge: an
 * auto-disabled provider stays off until a human turns it back on, which is
 * not something to discover from a tooltip.
 */
export const ProviderAutoDisabledNote = ({ provider }: ProviderHealthProps) => {
  const health = describeProviderHealth(provider);
  if (health?.autoDisabledNote === undefined) return null;

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3">
      <StrokeIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-600" paths={EXCLAMATION_TRIANGLE_PATHS} />
      <p className="text-xs text-red-800">
        <span className="font-semibold">The system switched this provider off. </span>
        {health.autoDisabledNote}
      </p>
    </div>
  );
};

function unconfiguredLabel(provider: ProviderConfig): string {
  if (provider.credential_from !== undefined) return `No ${credentialProviderName(provider.credential_from)} login`;
  return usesIamAuth(provider) ? 'Gateway not deployed' : 'Not configured';
}

function configuredLabel(provider: ProviderConfig): string {
  if (usesIamAuth(provider)) return 'IAM — no key needed';
  return provider.credential_from === undefined ? 'Configured' : borrowedCredentialText(provider.credential_from);
}

/** "Configured" plus the masked key and health, or the amber "Not configured" pill. */
export const ProviderStatus = ({ provider }: ProviderHealthProps) => {
  if (!provider.configured) {
    return <span className="text-xs text-amber-700 bg-gray-50 px-2 py-1 rounded-sm">{unconfiguredLabel(provider)}</span>;
  }
  const ownKey = !usesIamAuth(provider) && provider.credential_from === undefined;
  return (
    <>
      <span className="text-xs text-emerald-700 bg-gray-50 px-2 py-1 rounded-sm">{configuredLabel(provider)}</span>
      {ownKey && provider.masked_key && <span className="text-xs text-gray-500 font-mono">{provider.masked_key}</span>}
      <ProviderHealthBadge provider={provider} />
    </>
  );
};

interface ProviderToggleProps {
  readonly provider: ProviderConfig;
  readonly saving: boolean;
  readonly onToggle: () => void;
}

/** The enable/disable switch; inert until an API key is stored. */
export const ProviderToggle = ({
  provider, saving, onToggle
}: ProviderToggleProps) => {
  const on = provider.enabled && provider.configured;
  return (
    <button
      onClick={onToggle}
      disabled={saving || !provider.configured}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        on ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-500'
      } ${provider.configured ? '' : 'opacity-50 cursor-not-allowed'}`}
      title={getToggleTitle(provider)}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        on ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
};
