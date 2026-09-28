import {
  useEffect, useId, useState
} from 'react';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import { useLatestRequest } from '../../hooks/useLatestRequest';
import {
  fetchProviderModels, saveProviderModel
} from '../../api/providerModels';

export interface ProviderModelEditorProps {
  readonly provider: ProviderConfig;
  /** Reload the provider list once a model was stored. */
  readonly onSaved: () => Promise<void>;
  readonly onClose: () => void;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type ModelListState =
  | { status: 'loading' }
  | {
    status: 'ready';
    models: string[];
  }
  | {
    status: 'failed';
    message: string;
  };

/** The ids the stored key can use, loaded when the editor opens (and again for another provider). */
function useModelList(providerId: string): ModelListState {
  const { beginRequest } = useLatestRequest();
  const [state, setState] = useState<ModelListState>({ status: 'loading' });

  useEffect(() => {
    const request = beginRequest();
    fetchProviderModels(providerId, request.signal)
      .then((listing) => {
        if (request.isCurrent()) setState({
          status: 'ready',
          models: listing.models,
        });
      })
      .catch((error: unknown) => {
        if (request.isCurrent()) setState({
          status: 'failed',
          message: errorText(error, 'Could not list models'),
        });
      })
      .finally(request.finish);
  }, [beginRequest, providerId]);

  return state;
}

function listHint(state: ModelListState): string {
  if (state.status === 'loading') return 'Loading the models your key can use...';
  if (state.status === 'failed') return `${state.message}. You can still type a model id.`;
  return `${state.models.length} models available to your key. Pick one or type an id.`;
}

/**
 * Pick or type the model a provider answers with. The server checks the
 * model with a real web-search answer before it is stored, so a model that
 * cannot search is refused here instead of failing (and eventually
 * auto-disabling the provider) during the next run.
 */
export const ProviderModelEditor = ({
  provider, onSaved, onClose
}: ProviderModelEditorProps) => {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const modelList = useModelList(provider.id);
  const [value, setValue] = useState(provider.model);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultModel = provider.default_model ?? '';

  const save = async (model: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await saveProviderModel(provider.id, model);
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(errorText(saveError, 'Could not save the model'));
    } finally {
      setSaving(false);
    }
  };

  const trimmed = value.trim();

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <label htmlFor={inputId} className="block text-xs font-medium text-gray-700 mb-1">
        {`${provider.name} model`}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          list={listId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={hintId}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 p-2 text-sm font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900"
        />
        <datalist id={listId}>
          {modelList.status === 'ready' && modelList.models.map((model) => <option key={model} value={model} />)}
        </datalist>
        <button
          type="button"
          onClick={() => save(trimmed)}
          disabled={saving || trimmed === '' || trimmed === provider.model}
          className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {saving ? 'Checking...' : 'Check and save'}
        </button>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
      <p id={hintId} className="mt-2 text-xs text-gray-500">{listHint(modelList)}</p>
      {defaultModel !== '' && provider.model !== defaultModel && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={saving}
          className="mt-2 text-xs text-gray-700 underline hover:text-gray-900 disabled:opacity-50"
        >
          {`Use the default (${defaultModel})`}
        </button>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Saving sends one short web-search prompt with this model to prove it works. New runs and keyword research use it
        straight away; earlier results keep the model they were produced with.
      </p>
    </div>
  );
};
