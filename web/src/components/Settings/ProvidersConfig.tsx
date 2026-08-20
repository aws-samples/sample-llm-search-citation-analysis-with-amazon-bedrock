import { useState } from 'react';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import { describeProviderHealth } from '../../formatting/providerHealth';
import type {
  ProviderHealthDescriptor, ProviderHealthTone
} from '../../formatting/providerHealth';
import { formatRelativeTime } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';

export interface ProvidersConfigProps {
  readonly providers: ProviderConfig[];
  readonly loading: boolean;
  readonly onUpdate: (providerId: string, updates: {
    enabled?: boolean;
    api_key?: string 
  }) => Promise<boolean>;
  readonly onRefresh: () => Promise<void>;
  /** Threaded from the parent, which already resolved membership. */
  readonly isAdmin: boolean;
}

function getProviderCardBorderClass(configured: boolean, enabled: boolean): string {
  if (configured && enabled) return 'border-emerald-200';
  if (configured) return 'border-amber-200';
  return 'border-gray-200';
}

function getProviderDotClass(configured: boolean, enabled: boolean): string {
  if (configured && enabled) return 'bg-emerald-500';
  if (configured) return 'bg-amber-500';
  return 'bg-gray-300';
}

function getToggleTitle(configured: boolean, enabled: boolean): string {
  if (!configured) return 'Configure API key first';
  return enabled ? 'Disable' : 'Enable';
}

/**
 * Credit exhaustion and rejected keys stop the provider until someone acts, so
 * they get the loudest treatment; rate limits and timeouts usually clear up on
 * their own.
 */
const HEALTH_TONE_CLASSES: Record<ProviderHealthTone, string> = {
  ok: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  warning: 'text-amber-800 bg-amber-50 border-amber-200',
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
      className={`text-xs px-2 py-1 rounded border ${HEALTH_TONE_CLASSES[health.tone]}`}
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
const ProviderAutoDisabledNote = ({ provider }: ProviderHealthProps) => {
  const health = describeProviderHealth(provider);
  if (health?.autoDisabledNote === undefined) return null;

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3">
      <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <p className="text-xs text-red-800">
        <span className="font-semibold">The system switched this provider off. </span>
        {health.autoDisabledNote}
      </p>
    </div>
  );
};

export const ProvidersConfig = ({
  providers, loading, onUpdate, onRefresh, isAdmin 
}: ProvidersConfigProps) => {
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggleEnabled = async (providerId: string, currentEnabled: boolean) => {
    setSaving(providerId);
    setError(null);
    const success = await onUpdate(providerId, { enabled: !currentEnabled });
    if (!success) {
      setError(`Failed to update ${providerId}`);
    }
    setSaving(null);
  };

  const handleSaveApiKey = async (providerId: string) => {
    if (!apiKeyInput.trim()) {
      setError('API key cannot be empty');
      return;
    }
    setSaving(providerId);
    setError(null);
    const success = await onUpdate(providerId, { api_key: apiKeyInput.trim() });
    if (success) {
      setEditingProvider(null);
      setApiKeyInput('');
    } else {
      setError(`Failed to save API key for ${providerId}`);
    }
    setSaving(null);
  };

  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
    setApiKeyInput('');
    setError(null);
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setError(null);
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading providers...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">AI Provider Configuration</h3>
          <p className="text-xs text-gray-500 mt-1">Configure API keys and enable/disable providers for analysis</p>
        </div>
        <button onClick={onRefresh} className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-4">
        {providers.map((provider) => (
          <div key={provider.id} className={`bg-white rounded-lg border p-4 transition-colors ${getProviderCardBorderClass(provider.configured, provider.enabled)}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className={`mt-1 w-3 h-3 rounded-full ${getProviderDotClass(provider.configured, provider.enabled)}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-900">{provider.name}</h4>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{provider.model}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{provider.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {provider.configured ? (
                      <>
                        <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Configured</span>
                        {provider.masked_key && <span className="text-xs text-gray-500 font-mono">{provider.masked_key}</span>}
                        <ProviderHealthBadge provider={provider} />
                      </>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">Not configured</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Both controls call PUT /api/providers/{id}, which is
                    Admin-only server-side. Non-admins keep the read-only card,
                    the status badge, and the docs link. */}
                {isAdmin && (
                  <>
                    <button
                      onClick={() => handleToggleEnabled(provider.id, provider.enabled)}
                      disabled={saving === provider.id || !provider.configured}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        provider.enabled && provider.configured ? 'bg-emerald-500' : 'bg-gray-300'
                      } ${provider.configured ? '' : 'opacity-50 cursor-not-allowed'}`}
                      title={getToggleTitle(provider.configured, provider.enabled)}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        provider.enabled && provider.configured ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                    <button onClick={() => startEditing(provider.id)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                      {provider.configured ? 'Update Key' : 'Add Key'}
                    </button>
                  </>
                )}
                <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Get API Key">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>

            <ProviderAutoDisabledNote provider={provider} />

            {isAdmin && editingProvider === provider.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={`Enter ${provider.name} API key...`}
                    className="flex-1 p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveApiKey(provider.id)}
                    disabled={saving === provider.id}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving === provider.id ? <Spinner size="sm" /> : 'Save'}
                  </button>
                  <button onClick={cancelEditing} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Get your API key from{' '}
                  <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="text-gray-700 underline hover:text-gray-900">
                    {provider.name}'s console
                  </a>
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h4 className="text-sm font-medium text-gray-900 mb-2">How it works</h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Only enabled providers with configured API keys will be used during analysis</li>
          <li>• API keys are stored securely in AWS Secrets Manager</li>
          <li>• Disable providers temporarily without removing their API keys</li>
          <li>• Each provider has different capabilities and pricing</li>
          {!isAdmin && (
            <li>• Changing provider settings requires an administrator</li>
          )}
        </ul>
      </div>
    </div>
  );
};
