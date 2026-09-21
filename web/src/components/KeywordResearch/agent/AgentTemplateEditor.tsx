import {
  useId, useMemo, useRef, useState
} from 'react';
import type { ResearchTemplate } from '../../../types';
import type {
  TemplateChanges, TemplateDraft
} from '../../../api/keywordResearch';
import type { TemplateMutationOutcome } from '../../../hooks/useResearchTemplates';
import { Button } from '../../ui';
import { Spinner } from '../../ui/Spinner';
import { SYSTEM_PROMPT_MAX_LENGTH } from './agentBrief';
import {
  DIMENSION_DESCRIPTION_MAX_LENGTH,
  DIMENSION_LABEL_MAX_LENGTH,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_MAX_DIMENSIONS,
  TEMPLATE_MIN_DIMENSIONS,
  TEMPLATE_NAME_MAX_LENGTH,
  dimensionRowId,
  draftFromTemplate,
  hasTemplateDraftProblems,
  newTemplateDraft,
  templateChanges,
  templateDraftProblems,
} from './agentTemplateDraft';
import type {
  DimensionRow, TemplateDraftFields
} from './agentTemplateDraft';

interface AgentTemplateEditorProps {
  /** The selected template; the parent keys this component by its id so the draft restarts on a switch. */
  readonly template: ResearchTemplate;
  /** The prompt as currently edited in the brief (the run uses this text). */
  readonly systemPrompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onSaveAsNew: (draft: TemplateDraft) => Promise<TemplateMutationOutcome>;
  readonly onUpdate: (changes: TemplateChanges) => Promise<TemplateMutationOutcome>;
  readonly onDelete: () => Promise<TemplateMutationOutcome>;
  readonly disabled?: boolean;
}

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50';

function FieldProblem({ message }: { readonly message: string | undefined }) {
  if (message === undefined) return null;
  return <p role="alert" className="mt-1 text-xs text-red-700">{message}</p>;
}

function ProfileField({
  id, label, value, maxLength, problem, disabled, onChange
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly maxLength: number;
  readonly problem: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-600 mb-1">{label}</label>
      <input id={id} type="text" value={value} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS} />
      <FieldProblem message={problem} />
    </div>
  );
}

/**
 * Edits the selected template as an industry profile — name, description,
 * subject, audience, expansion dimensions and the system prompt — and saves
 * it back or as a new template. Built-ins are read-only: their edits can only
 * be saved as a copy. The prompt is the brief's: whatever it holds when the
 * run starts is what the run uses.
 */
export function AgentTemplateEditor({
  template, systemPrompt, onPromptChange, onSaveAsNew, onUpdate, onDelete, disabled = false
}: AgentTemplateEditorProps) {
  const ids = {
    name: useId(),
    description: useId(),
    subject: useId(),
    audience: useId(),
    prompt: useId(),
  };
  const [draft, setDraft] = useState<TemplateDraftFields>(() => draftFromTemplate(template));
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const nextRowKey = useRef(0);

  const problems = useMemo(() => templateDraftProblems(draft, systemPrompt), [draft, systemPrompt]);
  const invalid = hasTemplateDraftProblems(problems);
  const shown = attempted ? problems : { rows: {} };
  const changes = useMemo(() => templateChanges(template, draft, systemPrompt), [template, draft, systemPrompt]);
  const hasChanges = Object.keys(changes).length > 0;
  const promptDirty = systemPrompt !== template.system_prompt;
  const remaining = SYSTEM_PROMPT_MAX_LENGTH - systemPrompt.length;

  const setField = (field: keyof Omit<TemplateDraftFields, 'rows'>, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateRow = (key: string, patch: Partial<Omit<DimensionRow, 'key'>>) => {
    setDraft((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.key === key ? {
        ...row,
        ...patch,
      } : row)),
    }));
  };

  const addRow = () => {
    nextRowKey.current += 1;
    const row: DimensionRow = {
      key: `new-${nextRowKey.current}`,
      label: '',
      description: '',
    };
    setDraft((prev) => ({
      ...prev,
      rows: [...prev.rows, row],
    }));
  };

  const removeRow = (key: string) => {
    setDraft((prev) => ({
      ...prev,
      rows: prev.rows.filter((row) => row.key !== key),
    }));
  };

  const save = async (mutation: () => Promise<TemplateMutationOutcome>) => {
    setAttempted(true);
    if (invalid) return;
    setSaving(true);
    try {
      await mutation();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!globalThis.confirm(`Delete template "${template.name}"? Runs that used it keep their own copy of the prompt.`)) return;
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" aria-label="Template editor">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProfileField id={ids.name} label="Template name" value={draft.name} maxLength={TEMPLATE_NAME_MAX_LENGTH} problem={shown.name} disabled={disabled} onChange={(value) => setField('name', value)} />
        <ProfileField id={ids.description} label="Description" value={draft.description} maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH} problem={undefined} disabled={disabled} onChange={(value) => setField('description', value)} />
        <ProfileField id={ids.subject} label="Subject (what is researched, singular)" value={draft.subject} maxLength={40} problem={shown.subject} disabled={disabled} onChange={(value) => setField('subject', value)} />
        <ProfileField id={ids.audience} label="Audience (who searches for it, plural)" value={draft.audience} maxLength={40} problem={shown.audience} disabled={disabled} onChange={(value) => setField('audience', value)} />
      </div>

      <fieldset>
        <legend className="block text-xs text-gray-600 mb-2">Expansion dimensions ({TEMPLATE_MIN_DIMENSIONS}–{TEMPLATE_MAX_DIMENSIONS}; the id is derived from the label)</legend>
        <ul className="space-y-2">
          {draft.rows.map((row) => (
            <li key={row.key} className="rounded-lg border border-gray-200 bg-white p-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-start">
                <input
                  id={`template-dimension-${row.key}-label`}
                  name="dimension-label"
                  type="text"
                  aria-label="Dimension label"
                  value={row.label}
                  maxLength={DIMENSION_LABEL_MAX_LENGTH}
                  disabled={disabled}
                  placeholder="Label"
                  onChange={(event) => updateRow(row.key, { label: event.target.value })}
                  className={INPUT_CLASS}
                />
                <input
                  id={`template-dimension-${row.key}-description`}
                  name="dimension-description"
                  type="text"
                  aria-label="Dimension description"
                  value={row.description}
                  maxLength={DIMENSION_DESCRIPTION_MAX_LENGTH}
                  disabled={disabled}
                  placeholder="What the agent should expand along"
                  onChange={(event) => updateRow(row.key, { description: event.target.value })}
                  className={INPUT_CLASS}
                />
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => removeRow(row.key)} aria-label={`Remove dimension ${row.label || 'row'}`}>
                  Remove
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">id: {dimensionRowId(row) || '—'}</p>
              <FieldProblem message={shown.rows[row.key]} />
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={disabled || draft.rows.length >= TEMPLATE_MAX_DIMENSIONS} onClick={addRow}>
            Add dimension
          </Button>
          <FieldProblem message={shown.dimensions} />
        </div>
      </fieldset>

      <div>
        <label htmlFor={ids.prompt} className="block text-xs text-gray-600 mb-1">Instructions (system prompt)</label>
        <textarea
          id={ids.prompt}
          value={systemPrompt}
          disabled={disabled}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={10}
          maxLength={SYSTEM_PROMPT_MAX_LENGTH}
          className={`${INPUT_CLASS} font-mono`}
        />
        <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500 mt-1">
          <span>
            {promptDirty
              ? 'Edited — the run uses this text; save it to reuse it.'
              : 'The run uses this text as the agent\u2019s standing instructions.'}
          </span>
          <span>{remaining} characters left</span>
        </div>
        <FieldProblem message={shown.systemPrompt} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={disabled || saving} onClick={() => void save(() => onSaveAsNew(newTemplateDraft(template, draft, systemPrompt)))}>
          Save as new template
        </Button>
        {template.builtin ? (
          <span className="text-xs text-gray-500">{'Built-in templates can\u2019t be edited — save a copy.'}</span>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={disabled || saving || !hasChanges} onClick={() => void save(() => onUpdate(changes))}>
              Update template
            </Button>
            <Button type="button" variant="danger" size="sm" disabled={disabled || saving} onClick={() => void handleDelete()}>
              Delete template
            </Button>
          </>
        )}
        {saving && <Spinner size="sm" className="text-gray-400" />}
      </div>
    </div>
  );
}
