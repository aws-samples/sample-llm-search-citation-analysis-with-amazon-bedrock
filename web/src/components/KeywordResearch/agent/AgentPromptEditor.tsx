import {
  useId, useState
} from 'react';
import type { ResearchTemplate } from '../../../types';
import type { TemplateMutationOutcome } from '../../../hooks/useResearchTemplates';
import { Button } from '../../ui';
import { Spinner } from '../../ui/Spinner';
import {
  BUILTIN_TEMPLATE_ID, SYSTEM_PROMPT_MAX_LENGTH
} from './agentBrief';

interface AgentPromptEditorProps {
  readonly templates: ResearchTemplate[];
  readonly loading: boolean;
  /** The template the prompt was loaded from. */
  readonly templateId: string;
  /** The prompt as currently edited (may differ from the template). */
  readonly systemPrompt: string;
  readonly onTemplateChange: (template: ResearchTemplate) => void;
  readonly onPromptChange: (prompt: string) => void;
  readonly onSaveAsNew: (name: string) => Promise<TemplateMutationOutcome>;
  readonly onUpdate: () => Promise<TemplateMutationOutcome>;
  readonly onDelete: () => Promise<TemplateMutationOutcome>;
  readonly disabled?: boolean;
}

/**
 * The agent's system prompt: pick a template, edit the text inline, save the
 * edit back to the template or as a new one. The built-in template is
 * read-only — edits to it can only be saved as a copy. Whatever the textarea
 * holds when the run starts is what the run uses (snapshotted server-side).
 */
export function AgentPromptEditor({
  templates, loading, templateId, systemPrompt, onTemplateChange, onPromptChange, onSaveAsNew, onUpdate, onDelete, disabled = false
}: AgentPromptEditorProps) {
  const selectId = useId();
  const textareaId = useId();
  const nameId = useId();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [notice, setNotice] = useState<TemplateMutationOutcome | null>(null);

  const current = templates.find((template) => template.id === templateId);
  const isBuiltin = current?.builtin ?? templateId === BUILTIN_TEMPLATE_ID;
  const dirty = current !== undefined && current.system_prompt !== systemPrompt;
  const remaining = SYSTEM_PROMPT_MAX_LENGTH - systemPrompt.length;

  const runMutation = async (mutation: () => Promise<TemplateMutationOutcome>) => {
    setSaving(true);
    setNotice(null);
    try {
      const outcome = await mutation();
      setNotice(outcome);
      return outcome;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
    const name = newName.trim();
    if (!name) return;
    const outcome = await runMutation(() => onSaveAsNew(name));
    if (outcome.success) {
      setNewName('');
      setSavingAsNew(false);
    }
  };

  const handleDelete = async () => {
    if (!globalThis.confirm(`Delete template "${current?.name ?? ''}"? Runs that used it keep their own copy of the prompt.`)) return;
    await runMutation(onDelete);
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3" aria-label="Agent instructions">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label htmlFor={selectId} className="block text-sm text-gray-600 mb-1">Agent instructions (template)</label>
          <div className="flex items-center gap-2">
            <select
              id={selectId}
              value={templateId}
              disabled={disabled || loading}
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) onTemplateChange(template);
              }}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.builtin ? ' · built-in' : ''}
                </option>
              ))}
            </select>
            {loading && <Spinner size="sm" className="text-gray-400" />}
          </div>
          {current?.description && <p className="mt-1 text-xs text-gray-500">{current.description}</p>}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={textareaId}
        >
          {expanded ? 'Hide instructions' : 'Edit instructions'}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3">
          <div>
            <label htmlFor={textareaId} className="sr-only">System prompt</label>
            <textarea
              id={textareaId}
              value={systemPrompt}
              disabled={disabled}
              onChange={(event) => onPromptChange(event.target.value)}
              rows={12}
              maxLength={SYSTEM_PROMPT_MAX_LENGTH}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500 mt-1">
              <span>
                {dirty
                  ? 'Edited — the run uses this text; save it to reuse it.'
                  : 'The run uses this text as the agent\u2019s standing instructions.'}
              </span>
              <span>{remaining} characters left</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isBuiltin && (
              <Button type="button" variant="secondary" size="sm" disabled={disabled || saving || !dirty} onClick={() => void runMutation(onUpdate)}>
                Save changes to template
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={disabled || saving} onClick={() => setSavingAsNew((value) => !value)}>
              Save as new template
            </Button>
            {!isBuiltin && (
              <Button type="button" variant="danger" size="sm" disabled={disabled || saving} onClick={() => void handleDelete()}>
                Delete template
              </Button>
            )}
            {saving && <Spinner size="sm" className="text-gray-400" />}
          </div>

          {savingAsNew && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <div className="flex-1">
                <label htmlFor={nameId} className="block text-xs text-gray-600 mb-1">Template name</label>
                <input
                  id={nameId}
                  type="text"
                  value={newName}
                  maxLength={100}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Beach resorts – families"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
                />
              </div>
              <Button type="button" size="sm" disabled={saving || newName.trim().length === 0} onClick={() => void handleSaveAsNew()}>
                Save template
              </Button>
            </div>
          )}

          {notice && (
            <output className={`block text-sm ${notice.success ? 'text-green-700' : 'text-red-700'}`}>{notice.message}</output>
          )}
        </div>
      )}
    </section>
  );
}
