import { useState } from 'react';
import { KeywordsManager } from '../Keywords/KeywordsManager';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import {useProviderConfig} from '../../hooks/useProviderConfig';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import { BrandConfigContent } from '../Brands/BrandConfigContent';
import { UsersConfig } from './UsersConfig';
import { QueryPromptsManager } from './QueryPromptsManager';
import type { Keyword } from '../../types';

interface SettingsViewProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
}

type SettingsTab = 'keywords' | 'brand-config' | 'query-prompts' | 'providers' | 'users';

function getProviderBadgeClass(enabledCount: number, configuredCount: number): string {
  if (enabledCount === configuredCount && configuredCount > 0) {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (configuredCount > 0) {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-gray-100 text-gray-600';
}

export const SettingsView = ({
  keywords, setKeywords 
}: SettingsViewProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('keywords');
  const {
    config, presets, loading: configLoading, saveConfig, expandAllBrands, findCompetitors 
  } = useBrandConfig();
  const {
    providers, loading: providersLoading, updateProvider, refreshProviders 
  } = useProviderConfig();

  const industryName = config?.industry
    ? presets?.[config.industry]?.name ?? config.industry
    : 'Not configured';
  
  const configuredCount = providers.filter(p => p.configured).length;
  const enabledCount = providers.filter(p => p.enabled && p.configured).length;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab('keywords')}
              className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'keywords'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="hidden sm:inline">Keywords</span>
                <span className="ml-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                  {keywords.length}
                </span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('brand-config')}
              className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'brand-config'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span className="hidden sm:inline">Brand Tracking</span>
                <span className="hidden lg:inline ml-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                  {industryName}
                </span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('query-prompts')}
              className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'query-prompts'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span className="hidden sm:inline">Query Prompts</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('providers')}
              className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'providers'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="hidden sm:inline">AI Providers</span>
                <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${getProviderBadgeClass(enabledCount, configuredCount)}`}>
                  {enabledCount}/{providers.length}
                </span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'users'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                <span className="hidden sm:inline">Users</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6">
          {activeTab === 'keywords' && (
            <KeywordsManager keywords={keywords} setKeywords={setKeywords} />
          )}

          {activeTab === 'brand-config' && (
            <BrandConfigContent
              config={config}
              presets={presets}
              loading={configLoading}
              onSave={saveConfig}
              onExpandAllBrands={expandAllBrands}
              onFindCompetitors={findCompetitors}
            />
          )}

          {activeTab === 'query-prompts' && (
            <QueryPromptsManager />
          )}

          {activeTab === 'providers' && (
            <ProvidersConfig
              providers={providers}
              loading={providersLoading}
              onUpdate={updateProvider}
              onRefresh={refreshProviders}
            />
          )}

          {activeTab === 'users' && (
            <UsersConfig />
          )}
        </div>
      </div>
    </div>
  );
};

// Providers Configuration Component
interface ProvidersConfigProps {
  readonly providers: ProviderConfig[];
  readonly loading: boolean;
  readonly onUpdate: (providerId: string, updates: {
    enabled?: boolean;
    api_key?: string 
  }) => Promise<boolean>;
  readonly onRefresh: () => Promise<void>;
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

const ProvidersConfig = ({
  providers, loading, onUpdate, onRefresh 
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
                  <div className="mt-2 flex items-center gap-2">
                    {provider.configured ? (
                      <>
                        <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Configured</span>
                        {provider.masked_key && <span className="text-xs text-gray-500 font-mono">{provider.masked_key}</span>}
                      </>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">Not configured</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Get API Key">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>

            {editingProvider === provider.id && (
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
                    {saving === provider.id ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : 'Save'}
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
        </ul>
      </div>
    </div>
  );
};
