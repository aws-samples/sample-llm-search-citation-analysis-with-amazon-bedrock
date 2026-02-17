/**
 * Query Prompts Manager — CRUD UI for persona-based query templates.
 */
import { useState } from 'react';
import { useQueryPrompts } from '../../hooks/useQueryPrompts';
import type { QueryPrompt } from '../../types';

const SAMPLE_KEYWORD = 'best hotels in Barcelona';

function PromptPreview({ template }: { readonly template: string }) {
  if (!template) return null;
  const preview = template.replace('{keyword}', SAMPLE_KEYWORD);
  return (
    <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
      <span className="text-gray-400">Preview: </span>{preview}
    </div>
  );
}

function PromptForm({
  onSubmit,
  initialName = '',
  initialTemplate = '',
  submitLabel = 'Create',
  onCancel,
}: {
  readonly onSubmit: (name: string, template: string) => Promise<void>;
  readonly initialName?: string;
  readonly initialTemplate?: string;
  readonly submitLabel?: string;
  readonly onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [template, setTemplate] = useState(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !template.trim()) return;
    if (!template.includes('{keyword}')) {
      setValidationError('Template must contain {keyword} placeholder');
      return;
    }
    setValidationError('');
    setSaving(true);
    try {
      await onSubmit(name.trim(), template.trim());
      if (submitLabel === 'Create') {
        setName('');
        setTemplate('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="prompt-name" className="block text-sm font-medium text-gray-700 mb-1">
          Persona Name
        </label>
        <input
          id="prompt-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Family Traveler"
          className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900"
          maxLength={100}
          required
        />
      </div>
      <div>
        <label htmlFor="prompt-template" className="block text-sm font-medium text-gray-700 mb-1">
          Query Template
        </label>
        <textarea
          id="prompt-template"
          value={template}
          onChange={e => { setTemplate(e.target.value); setValidationError(''); }}
          placeholder="e.g. As a family traveler with 3 kids, what are the best hotels for {keyword}?"
          className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 min-h-[80px]"
          maxLength={2000}
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          Use <code className="bg-gray-100 px-1 rounded">{'{keyword}'}</code> where the search keyword should be inserted.
        </p>
        {validationError && (
          <p className="text-xs text-red-600 mt-1">{validationError}</p>
        )}
        <PromptPreview template={template} />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !template.trim()}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 text-sm hover:text-gray-900">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PromptRow({
  prompt,
  onToggle,
  onUpdate,
  onDelete,
}: {
  readonly prompt: QueryPrompt;
  readonly onToggle: (id: string) => Promise<unknown>;
  readonly onUpdate: (id: string, updates: { name?: string; template?: string }) => Promise<unknown>;
  readonly onDelete: (id: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isEnabled = prompt.enabled === 'true';

  const handleToggle = async () => {
    setToggling(true);
    try { await onToggle(prompt.id); } finally { setToggling(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(prompt.id); } finally { setDeleting(false); }
  };

  if (editing) {
    return (
      <div className="p-4 border border-gray-200 rounded-lg">
        <PromptForm
          initialName={prompt.name}
          initialTemplate={prompt.template}
          submitLabel="Save"
          onSubmit={async (name, template) => {
            await onUpdate(prompt.id, { name, template });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`p-4 border rounded-lg ${isEnabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{prompt.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${isEnabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {isEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{prompt.template}</p>
        </div>
        <div className="flex items-center gap-1 ml-3">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            title={isEnabled ? 'Disable' : 'Enable'}
            aria-label={isEnabled ? 'Disable prompt' : 'Enable prompt'}
          >
            {toggling ? '...' : isEnabled ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            title="Edit"
            aria-label="Edit prompt"
          >
            ✏️
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-gray-400 hover:text-red-600 rounded"
            title="Delete"
            aria-label="Delete prompt"
          >
            {deleting ? '...' : '🗑'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QueryPromptsManager() {
  const { prompts, loading, error, createPrompt, updatePrompt, deletePrompt, togglePrompt } = useQueryPrompts();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Query Prompts</h3>
          <p className="text-sm text-gray-500">
            Define persona-based search templates. Each prompt runs against every keyword during analysis.
          </p>
        </div>
        {!showCreate && prompts.length < 10 && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800"
          >
            + New Prompt
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {showCreate && (
        <div className="p-4 border border-gray-300 rounded-lg bg-gray-50">
          <PromptForm
            onSubmit={async (name, template) => {
              await createPrompt(name, template);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading prompts...</div>
      ) : prompts.length === 0 && !showCreate ? (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">No query prompts yet.</p>
          <p className="text-xs mt-1">Create one to run persona-based searches across your keywords.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prompts.map(prompt => (
            <PromptRow
              key={prompt.id}
              prompt={prompt}
              onToggle={togglePrompt}
              onUpdate={updatePrompt}
              onDelete={deletePrompt}
            />
          ))}
        </div>
      )}

      {prompts.length > 0 && (
        <p className="text-xs text-gray-400">
          {prompts.filter(p => p.enabled === 'true').length} of {prompts.length} prompts enabled
          · Each analysis run will execute {prompts.filter(p => p.enabled === 'true').length || 1} queries per keyword per provider
        </p>
      )}
    </div>
  );
}
