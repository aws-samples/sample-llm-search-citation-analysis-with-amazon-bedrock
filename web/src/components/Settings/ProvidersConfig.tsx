import { useState } from 'react';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import { RefreshIcon } from '../ui';
import { ProvidersConfigSkeleton } from './ProvidersConfigSkeleton';
import { SettingsErrorNotice } from './SettingsErrorNotice';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  ProviderCard, type ProviderCardControls
} from './ProviderCard';
import {
  groupProviders, withBorrowedCredentials
} from './providerCredentials';

export interface ProvidersConfigProps {
  readonly providers: ProviderConfig[];
  readonly loading: boolean;
  readonly onUpdate: (providerId: string, updates: {
    enabled?: boolean;
    api_key?: string 
  }) => Promise<boolean>;
  readonly onRefresh: () => Promise<void>;
  /**
   * The reason the last update was refused, in the server's words
   * ("Provider check failed: Your credit balance is too low…"), from the
   * hook that made the call. Shown in preference to this panel's own message.
   */
  readonly updateError?: string | null;
  /** Threaded from the parent, which already resolved membership. */
  readonly isAdmin: boolean;
}

export const ProvidersConfig = ({
  providers, loading, onUpdate, onRefresh, updateError = null, isAdmin 
}: ProvidersConfigProps) => {
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggleEnabled = async (providerId: string, currentEnabled: boolean) => {
    setSaving(providerId);
    setError(null);
    const success = await onUpdate(providerId, { enabled: !currentEnabled });
    if (!success) {
      setError(`Could not update ${providerId}`);
      // Enabling is proven by a real call, and a failed probe is recorded on
      // the provider row: refresh so the card shows that fresh failure
      // rather than the one that caused the auto-disable weeks ago.
      await onRefresh();
    }
    setSaving(null);
  };

  const handleSaveApiKey = async (providerId: string, apiKey: string) => {
    if (!apiKey.trim()) {
      setError('API key cannot be empty');
      return;
    }
    setSaving(providerId);
    setError(null);
    const success = await onUpdate(providerId, { api_key: apiKey.trim() });
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

  const controlsFor = (provider: ProviderConfig): ProviderCardControls => ({
    isAdmin,
    saving: saving === provider.id,
    editingKey: editingProvider === provider.id,
    editingModel: editingModel === provider.id,
    apiKeyInput,
    onApiKeyInput: setApiKeyInput,
    onToggle: () => handleToggleEnabled(provider.id, provider.enabled),
    onEditKey: () => startEditing(provider.id),
    onEditModel: () => setEditingModel(provider.id),
    onCloseModel: () => setEditingModel(null),
    onSaveKey: (apiKey) => handleSaveApiKey(provider.id, apiKey),
    onInvalidKey: setError,
    onCancelKey: cancelEditing,
    onModelSaved: onRefresh,
  });

  const renderCard = (provider: ProviderConfig) => (
    <ProviderCard key={provider.id} provider={provider} controls={controlsFor(provider)} />
  );

  const groups = groupProviders(withBorrowedCredentials(providers));

  // Only the first load: a refresh keeps the cards (and any open editor) in place.
  if (loading && providers.length === 0) {
    return <ProvidersConfigSkeleton />;
  }

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="AI Provider Configuration" description="Configure API keys and enable/disable providers for analysis">
        <button onClick={onRefresh} className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2">
          <RefreshIcon className="w-4 h-4" />
          Refresh
        </button>
      </SettingsSectionHeader>

      <SettingsErrorNotice error={updateError ?? error} />

      <div className="space-y-4">
        {groups.engines.map(renderCard)}
      </div>

      {groups.seo.length > 0 && (
        <section aria-labelledby="seo-data-providers" className="space-y-4">
          <div>
            <h4 id="seo-data-providers" className="text-sm font-semibold text-gray-900">SEO data</h4>
            <p className="text-xs text-gray-600 mt-1">Search volume, keyword difficulty and Google results pages for the SEO views and the Google AI Overviews engine.</p>
          </div>
          {groups.seo.map(renderCard)}
        </section>
      )}

      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h4 className="text-sm font-medium text-gray-900 mb-2">How it works</h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Only enabled providers that are configured (an API key, or IAM access for the Amazon Bedrock Web Search gateway) will be used during analysis</li>
          <li>• API keys are stored securely in AWS Secrets Manager; the IAM provider needs no key</li>
          <li>• Disable providers temporarily without removing their API keys</li>
          <li>• The OpenAI and Gemini models can be changed as new versions appear; each is checked before it is saved</li>
          <li>• Each provider has different capabilities and pricing</li>
          {groups.seo.length > 0 && (
            <li>• DataForSEO takes a login and an API password; Google AI Overviews uses that login, so it can be enabled once the login is saved</li>
          )}
          {!isAdmin && (
            <li>• Changing provider settings requires an administrator</li>
          )}
        </ul>
      </div>
    </div>
  );
};
