import {
  useId, useState
} from 'react';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  validateProviderKey, type ProviderKeyCheck
} from '../../api/providerKeys';
import { getErrorMessage } from '../../infrastructure';
import { Spinner } from '../ui/Spinner';
import {
  credentialFieldLabel, joinCredential
} from './providerCredentials';

const SAVE_BUTTON_CLASS = 'px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2';
const SECONDARY_BUTTON_CLASS = 'px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50';
const INPUT_CLASS = 'w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900';

const KeySourceHint = ({ provider }: { readonly provider: ProviderConfig }) => (
  <p className="mt-2 text-xs text-gray-500">
    Get your API key from{' '}
    <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="text-gray-700 underline hover:text-gray-900">
      {provider.name}'s console
    </a>
  </p>
);

interface ApiKeyEditorProps {
  readonly provider: ProviderConfig;
  readonly value: string;
  readonly saving: boolean;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** The single password field of a provider with one API key. */
export const ApiKeyEditor = ({
  provider, value, saving, onChange, onSave, onCancel
}: ApiKeyEditorProps) => (
  <div className="mt-4 pt-4 border-t border-gray-100">
    <div className="flex gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${provider.name} API key...`}
        className={`flex-1 ${INPUT_CLASS}`}
        autoFocus
      />
      <button onClick={onSave} disabled={saving} className={SAVE_BUTTON_CLASS}>
        {saving ? <Spinner size="sm" /> : 'Save'}
      </button>
      <button onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
    </div>
    <KeySourceHint provider={provider} />
  </div>
);

type CheckState = { readonly status: 'idle' | 'checking' } | {
  readonly status: 'done';
  readonly check: ProviderKeyCheck;
};

const CheckResult = ({ state }: { readonly state: CheckState }) => {
  if (state.status !== 'done') return null;
  return state.check.valid
    ? <output className="mt-2 block text-xs text-emerald-700">Login accepted.</output>
    : <p role="alert" className="mt-2 text-xs text-red-700">{state.check.error}</p>;
};

interface CredentialFieldsEditorProps {
  readonly provider: ProviderConfig;
  /** The inputs the key is made of, in order (`['login', 'password']`). */
  readonly fields: readonly string[];
  readonly saving: boolean;
  /** Receives the fields joined as `"<login>:<password>"`, or the reason they cannot be. */
  readonly onSave: (apiKey: string) => void;
  readonly onInvalid: (reason: string) => void;
  readonly onCancel: () => void;
}

/**
 * One input per credential field (the password one masked), joined with `:`
 * into the API key the existing update and validate calls take. The values
 * live only in this editor: closing it discards them, and a stored password
 * is never sent back to the browser to show.
 */
export const CredentialFieldsEditor = ({
  provider, fields, saving, onSave, onInvalid, onCancel
}: CredentialFieldsEditorProps) => {
  const idPrefix = useId();
  const [values, setValues] = useState<readonly string[]>(() => fields.map(() => ''));
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const joined = joinCredential(fields, values);

  const setValue = (index: number, value: string) => {
    setValues((current) => current.map((entry, at) => (at === index ? value : entry)));
    setCheck({ status: 'idle' });
  };

  const runCheck = async (apiKey: string) => {
    setCheck({ status: 'checking' });
    try {
      setCheck({
        status: 'done',
        check: await validateProviderKey(provider.id, apiKey),
      });
    } catch (error) {
      setCheck({
        status: 'done',
        check: {
          valid: false,
          error: getErrorMessage(error, 'providers'),
        },
      });
    }
  };

  const submit = (action: (apiKey: string) => void) => () => {
    if (joined.ok) action(joined.apiKey);
    else onInvalid(joined.reason);
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field, index) => (
          <div key={field}>
            <label htmlFor={`${idPrefix}-${field}`} className="block text-xs font-medium text-gray-500 mb-1">
              {credentialFieldLabel(field)}
            </label>
            <input
              id={`${idPrefix}-${field}`}
              type={field === 'password' ? 'password' : 'text'}
              autoComplete={field === 'password' ? 'new-password' : 'off'}
              value={values[index]}
              onChange={(event) => setValue(index, event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={submit(onSave)} disabled={saving} className={SAVE_BUTTON_CLASS}>
          {saving ? <Spinner size="sm" /> : 'Save'}
        </button>
        <button onClick={submit(runCheck)} disabled={check.status === 'checking'} className={SECONDARY_BUTTON_CLASS}>
          {check.status === 'checking' ? 'Checking…' : 'Check login'}
        </button>
        <button onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
      </div>
      <CheckResult state={check} />
      <KeySourceHint provider={provider} />
    </div>
  );
};
