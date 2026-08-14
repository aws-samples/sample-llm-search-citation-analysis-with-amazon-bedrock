/**
 * Personas Manager — CRUD UI for persona-based query templates.
 *
 * Each persona represents a user profile (e.g. "Family Traveler", "Student")
 * whose context is injected into AI queries to see how responses change.
 *
 * Visual styling follows the design system documented in
 * `docs/design-system.md`:
 *   - Action icons use the shared Heroicons-style outline set from
 *     `components/ui/Icons.tsx` (matches the sidebar icon language).
 *   - Buttons use the `<Button>` component so primary/ghost variants stay
 *     consistent with the rest of the app and adapt to dark mode.
 *   - Surfaces, borders, and text rely on Tailwind tokens that are mapped
 *     to dark-mode equivalents through global overrides in `index.css`.
 */
import { useState } from 'react';
import { useQueryPrompts } from '../../hooks/useQueryPrompts';
import type { QueryPrompt } from '../../types';
import {
  Button,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '../ui';

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

function PersonaForm({
  onSubmit,
  initialName = '',
  initialDescription = '',
  initialTemplate = '',
  submitLabel = 'Create Persona',
  onCancel,
}: {
  readonly onSubmit: (name: string, template: string, description: string) => Promise<void>;
  readonly initialName?: string;
  readonly initialDescription?: string;
  readonly initialTemplate?: string;
  readonly submitLabel?: string;
  readonly onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
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
      await onSubmit(name.trim(), template.trim(), description.trim());
      if (submitLabel === 'Create Persona') {
        setName('');
        setDescription('');
        setTemplate('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="persona-name" className="block text-sm font-medium text-gray-700 mb-1">
          Persona Name
        </label>
        <input
          id="persona-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Family Traveler, Student, Business Executive"
          className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900"
          maxLength={100}
          required
        />
      </div>
      <div>
        <label htmlFor="persona-description" className="block text-sm font-medium text-gray-700 mb-1">
          Persona Description
        </label>
        <textarea
          id="persona-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. I am a father of 3 kids, we live in Switzerland and we are looking for family-friendly travel destinations with activities for children aged 5-12..."
          className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 min-h-[60px]"
          maxLength={1000}
        />
        <p className="text-xs text-gray-400 mt-1">
          Describe who this persona is. This helps you remember the context behind each persona.
        </p>
      </div>
      <div>
        <label htmlFor="persona-template" className="block text-sm font-medium text-gray-700 mb-1">
          Query Template
        </label>
        <textarea
          id="persona-template"
          value={template}
          onChange={e => { setTemplate(e.target.value); setValidationError(''); }}
          placeholder="e.g. As a father of 3 kids living in Switzerland looking for family travel, what are the best options for {keyword}?"
          className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 min-h-[80px]"
          maxLength={2000}
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          This is the actual prompt sent to AI providers. Use <code className="bg-gray-100 px-1 rounded">{'{keyword}'}</code> where the search keyword should be inserted.
        </p>
        {validationError && (
          <p className="text-xs text-red-600 mt-1">{validationError}</p>
        )}
        <PromptPreview template={template} />
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={saving || !name.trim() || !template.trim()}
        >
          {saving ? 'Saving...' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function PersonaRow({
  prompt,
  onToggle,
  onUpdate,
  onDelete,
}: {
  readonly prompt: QueryPrompt;
  readonly onToggle: (id: string) => Promise<unknown>;
  readonly onUpdate: (id: string, updates: {
    name?: string;
    template?: string;
    description?: string 
  }) => Promise<unknown>;
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
        <PersonaForm
          initialName={prompt.name}
          initialDescription={prompt.description ?? ''}
          initialTemplate={prompt.template}
          submitLabel="Save"
          onSubmit={async (name, template, description) => {
            await onUpdate(prompt.id, {
              name,
              template,
              description 
            });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const statusClass = isEnabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500';
  const statusLabel = isEnabled ? 'Enabled' : 'Disabled';
  const rowClass = isEnabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60';

  const toggleTitle = isEnabled ? 'Disable persona' : 'Enable persona';
  const ToggleIcon = isEnabled ? PauseIcon : PlayIcon;

  return (
    <div className={`p-4 border rounded-lg ${rowClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{prompt.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          {prompt.description && (
            <p className="text-xs text-gray-600 mt-1">{prompt.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-1 truncate">{prompt.template}</p>
        </div>
        <div className="flex items-center gap-1 ml-3">
          <Button
            variant="iconOnly"
            size="sm"
            onClick={handleToggle}
            disabled={toggling}
            title={toggleTitle}
            aria-label={toggleTitle}
          >
            <ToggleIcon className="w-4 h-4" />
          </Button>
          <Button
            variant="iconOnly"
            size="sm"
            onClick={() => setEditing(true)}
            title="Edit persona"
            aria-label="Edit persona"
          >
            <PencilIcon className="w-4 h-4" />
          </Button>
          <Button
            variant="iconOnly"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete persona"
            aria-label="Delete persona"
            className="hover:text-red-600"
          >
            <TrashIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QueryPromptsManager() {
  const {
    prompts, loading, error, createPrompt, updatePrompt, deletePrompt, togglePrompt 
  } = useQueryPrompts();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      {/* items-start + gap keep the description in its own column; without
          min-w-0 / shrink-0 the text ran underneath the button. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900">Personas</h3>
          <p className="text-sm text-gray-500">
            Define user personas to see how AI providers change their responses based on who is asking.
            Each persona runs against every keyword during analysis, giving you a keywords × providers × personas matrix.
          </p>
        </div>
        {!showCreate && prompts.length < 10 && (
          <Button
            onClick={() => setShowCreate(true)}
            leadingIcon={<PlusIcon className="w-4 h-4" />}
            className="shrink-0 whitespace-nowrap"
          >
            New Persona
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {showCreate && (
        <div className="p-4 border border-gray-300 rounded-lg bg-gray-50">
          <PersonaForm
            onSubmit={async (name, template, description) => {
              await createPrompt(name, template, description || undefined);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-400 py-4 text-center">Loading personas...</div>
      )}
      {!loading && prompts.length === 0 && !showCreate && (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">No personas configured yet.</p>
          <p className="text-xs mt-1">Create a persona to see how AI responses change based on user context.</p>
          <p className="text-xs mt-2 text-gray-300">
            Example: "I am a father of 3 living in Switzerland looking for family travel destinations"
          </p>
        </div>
      )}
      {!loading && prompts.length > 0 && (
        <div className="space-y-2">
          {prompts.map(prompt => (
            <PersonaRow
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
          {prompts.filter(p => p.enabled === 'true').length} of {prompts.length} personas enabled
          · Each analysis run will execute {prompts.filter(p => p.enabled === 'true').length || 1} queries per keyword per provider
        </p>
      )}
    </div>
  );
}
