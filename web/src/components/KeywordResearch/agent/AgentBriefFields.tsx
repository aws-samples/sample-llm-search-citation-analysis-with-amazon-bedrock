import type { ResearchTemplate } from '../../../types';
import { Spinner } from '../../ui/Spinner';
import type { MarketOption } from './agentBrief';

/** Shared input styling for every control of the research-agent brief. */
export const BRIEF_INPUT_CLASS = 'w-full px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50';

interface MarketSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly MarketOption[];
  readonly onChange: (code: string) => void;
}

/** Country or language: the listed markets, or "Other code…" with a free two-letter code. */
export function MarketSelect({
  id, label, value, options, onChange
}: MarketSelectProps) {
  const listed = options.some((option) => option.code === value);
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-gray-600 mb-1">{label}</label>
      <select id={id} value={listed ? value : 'other'} onChange={(event) => onChange(event.target.value === 'other' ? '' : event.target.value)} className={BRIEF_INPUT_CLASS}>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        <option value="other">Other code…</option>
      </select>
      {!listed && (
        <input
          type="text"
          aria-label={`${label} code`}
          value={value}
          maxLength={2}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          placeholder="two-letter code"
          className={`${BRIEF_INPUT_CLASS} mt-2`}
        />
      )}
    </div>
  );
}

function TemplateOptions({ templates }: { readonly templates: ResearchTemplate[] }) {
  return <>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</>;
}

interface TemplatePickerProps {
  readonly id: string;
  readonly templates: ResearchTemplate[];
  readonly loading: boolean;
  readonly value: string;
  readonly description: string | undefined;
  /** The brief's prompt no longer matches the template's; offers to go back to it. */
  readonly promptDirty: boolean;
  readonly onChange: (id: string) => void;
  readonly onResetPrompt: () => void;
}

/** The "Industry template" select — built-ins first, then the team's own — with the template's description and the edited-prompt notice. */
export function TemplatePicker({
  id, templates, loading, value, description, promptDirty, onChange, onResetPrompt
}: TemplatePickerProps) {
  const builtins = templates.filter((item) => item.builtin);
  const saved = templates.filter((item) => !item.builtin);
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-gray-600 mb-1">Industry template</label>
      <div className="flex items-center gap-2">
        <select id={id} value={value} disabled={loading || templates.length === 0} onChange={(event) => onChange(event.target.value)} className={BRIEF_INPUT_CLASS}>
          <optgroup label="Industry templates">
            <TemplateOptions templates={builtins} />
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="Your templates">
              <TemplateOptions templates={saved} />
            </optgroup>
          )}
        </select>
        {loading && <Spinner size="sm" className="text-gray-400" />}
      </div>
      {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      {promptDirty && (
        <p className="mt-1 text-xs text-amber-700">
          {'Using your edited instructions instead of the template\u2019s. '}
          <button type="button" onClick={onResetPrompt} className="underline hover:text-amber-900">Reset to template</button>
        </p>
      )}
    </div>
  );
}
