import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  DATAFORSEO_PROVIDER_ID, usesIamAuth
} from '../../constants/providers';
import { isSeoApiConfigured } from '../../api/seo';
import { StrokeIcon } from '../ui/StrokeIcon';
import { EXTERNAL_LINK_PATHS } from '../ui/iconPaths';
import { ProviderModelEditor } from './ProviderModelEditor';
import {
  getProviderCardBorderClass, getProviderDotClass, ProviderAutoDisabledNote, ProviderStatus, ProviderToggle
} from './ProviderCardParts';
import {
  ApiKeyEditor, CredentialFieldsEditor
} from './ProviderKeyEditors';
import { SeoAccountBalance } from './SeoAccountBalance';

/** What the panel lets a card do, and which of its editors is open. */
export interface ProviderCardControls {
  readonly isAdmin: boolean;
  readonly saving: boolean;
  readonly editingKey: boolean;
  readonly editingModel: boolean;
  readonly apiKeyInput: string;
  readonly onApiKeyInput: (value: string) => void;
  readonly onToggle: () => void;
  readonly onEditKey: () => void;
  readonly onEditModel: () => void;
  readonly onCloseModel: () => void;
  readonly onSaveKey: (apiKey: string) => void;
  readonly onInvalidKey: (reason: string) => void;
  readonly onCancelKey: () => void;
  readonly onModelSaved: () => Promise<void>;
}

interface Props {
  readonly provider: ProviderConfig;
  readonly controls: ProviderCardControls;
}

const SMALL_BUTTON_CLASS = 'px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors';

/** Whether the card stores a key of its own (not IAM, not borrowed from another provider). */
function hasOwnKey(provider: ProviderConfig): boolean {
  return !usesIamAuth(provider) && provider.credential_from === undefined;
}

function linkTitle(provider: ProviderConfig): string {
  return hasOwnKey(provider) ? 'Get API Key' : 'Documentation';
}

/** Both controls call PUT /api/providers/{id}, which is Admin-only server-side. */
const AdminControls = ({
  provider, controls
}: Props) => (
  <>
    <ProviderToggle provider={provider} saving={controls.saving} onToggle={controls.onToggle} />
    {provider.model_configurable === true && provider.configured && (
      <button onClick={controls.onEditModel} className={SMALL_BUTTON_CLASS}>Change model</button>
    )}
    {hasOwnKey(provider) && (
      <button onClick={controls.onEditKey} className={SMALL_BUTTON_CLASS}>
        {provider.configured ? 'Update Key' : 'Add Key'}
      </button>
    )}
  </>
);

const KeyEditor = ({
  provider, controls
}: Props) => {
  if (provider.credential_fields !== undefined) {
    return (
      <CredentialFieldsEditor
        provider={provider}
        fields={provider.credential_fields}
        saving={controls.saving}
        onSave={controls.onSaveKey}
        onInvalid={controls.onInvalidKey}
        onCancel={controls.onCancelKey}
      />
    );
  }
  return (
    <ApiKeyEditor
      provider={provider}
      value={controls.apiKeyInput}
      saving={controls.saving}
      onChange={controls.onApiKeyInput}
      onSave={() => controls.onSaveKey(controls.apiKeyInput)}
      onCancel={controls.onCancelKey}
    />
  );
};

/** One provider: status, description, health, the admin controls and the open editor. */
export const ProviderCard = ({
  provider, controls
}: Props) => {
  const showBalance = controls.isAdmin && provider.id === DATAFORSEO_PROVIDER_ID && provider.configured && isSeoApiConfigured();
  return (
    <div className={`bg-white rounded-lg border p-4 transition-colors ${getProviderCardBorderClass(provider.configured, provider.enabled)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className={`mt-1 w-3 h-3 rounded-full ${getProviderDotClass(provider.configured, provider.enabled)}`} />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900">{provider.name}</h4>
              {provider.model !== '' && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-sm">{provider.model}</span>}
            </div>
            <p className="text-xs text-gray-600 mt-1">{provider.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ProviderStatus provider={provider} />
              {showBalance && <SeoAccountBalance refreshKey={provider.masked_key} />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Non-admins keep the read-only card, the status badge, and the docs link. */}
          {controls.isAdmin && <AdminControls provider={provider} controls={controls} />}
          <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title={linkTitle(provider)}>
            <StrokeIcon className="w-4 h-4" paths={EXTERNAL_LINK_PATHS} />
          </a>
        </div>
      </div>

      <ProviderAutoDisabledNote provider={provider} />

      {controls.isAdmin && controls.editingKey && <KeyEditor provider={provider} controls={controls} />}

      {controls.isAdmin && controls.editingModel && (
        <ProviderModelEditor provider={provider} onSaved={controls.onModelSaved} onClose={controls.onCloseModel} />
      )}
    </div>
  );
};
