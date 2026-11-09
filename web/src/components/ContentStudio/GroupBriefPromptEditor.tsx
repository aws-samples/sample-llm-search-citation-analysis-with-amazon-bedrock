import {
  useId, useState
} from 'react';
import type {
  ContentBriefTemplate, GroupBriefMode
} from '../../types';
import { ChevronDownIcon } from '../ui/Icons';
import { Spinner } from '../ui/Spinner';
import {
  GROUP_BRIEF_ALLOWED_PLACEHOLDERS,
  GROUP_BRIEF_MAX_TEMPLATE_DESCRIPTION_LENGTH,
  GROUP_BRIEF_MAX_TEMPLATE_LENGTH,
  GROUP_BRIEF_MAX_TEMPLATE_NAME_LENGTH,
} from './GroupBriefForm-source';
import { FieldIssue } from './GroupBriefFields';

interface GroupBriefPromptEditorProps {
  readonly mode: GroupBriefMode;
  readonly templates: ContentBriefTemplate[];
  readonly templatesLoading: boolean;
  readonly selectedTemplate: ContentBriefTemplate | undefined;
  readonly templateName: string;
  readonly templateDescription: string;
  readonly promptTemplate: string;
  readonly dirty: boolean;
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly issue?: string;
  readonly notice?: {
    success: boolean;
    message: string;
  };
  readonly onSelect: (templateId: string) => void;
  readonly onNameChange: (name: string) => void;
  readonly onDescriptionChange: (description: string) => void;
  readonly onPromptChange: (promptTemplate: string) => void;
  readonly onReset: () => void;
  readonly onSaveAsNew: () => Promise<void>;
  readonly onUpdate: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
}

const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400';

function TemplateSelector({
  templates,
  loading,
  selectedTemplate,
  disabled,
  onSelect,
}: {
  readonly templates: ContentBriefTemplate[];
  readonly loading: boolean;
  readonly selectedTemplate: ContentBriefTemplate | undefined;
  readonly disabled: boolean;
  readonly onSelect: (templateId: string) => void;
}) {
  return (
    <div>
      <label htmlFor="content-brief-saved-template" className="block text-sm font-medium text-gray-900">
        Template
      </label>
      <select
        id="content-brief-saved-template"
        value={selectedTemplate?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        disabled={disabled || loading}
        className={`mt-1 ${INPUT_CLASS}`}
      >
        {loading && <option value="">Loading templates...</option>}
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.builtin ? `${template.name} (built-in)` : template.name}
          </option>
        ))}
      </select>
      {selectedTemplate?.description && (
        <p className="mt-1 text-xs text-gray-500">{selectedTemplate.description}</p>
      )}
    </div>
  );
}

function TemplateMetadata({
  name,
  description,
  disabled,
  onNameChange,
  onDescriptionChange,
}: {
  readonly name: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onNameChange: (name: string) => void;
  readonly onDescriptionChange: (description: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="content-brief-template-name" className="block text-xs text-gray-600">
          Template name
        </label>
        <input
          id="content-brief-template-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={GROUP_BRIEF_MAX_TEMPLATE_NAME_LENGTH}
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </div>
      <div>
        <label htmlFor="content-brief-template-description" className="block text-xs text-gray-600">
          Description
        </label>
        <input
          id="content-brief-template-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          maxLength={GROUP_BRIEF_MAX_TEMPLATE_DESCRIPTION_LENGTH}
          disabled={disabled}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </div>
    </div>
  );
}

function PromptField({
  prompt,
  dirty,
  disabled,
  issue,
  onPromptChange,
  onReset,
}: {
  readonly prompt: string;
  readonly dirty: boolean;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onReset: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="group-brief-template" className="text-sm font-medium text-gray-900">
          Prompt template
        </label>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled || !dirty}
          className="text-sm font-medium text-gray-700 hover:text-gray-900 disabled:text-gray-400"
        >
          Reset changes
        </button>
      </div>
      <textarea
        id="group-brief-template"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        maxLength={GROUP_BRIEF_MAX_TEMPLATE_LENGTH}
        rows={12}
        disabled={disabled}
        className={`mt-1 ${INPUT_CLASS} font-mono`}
      />
      <div className="mt-1 flex flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:justify-between">
        <span>
          Allowed placeholders: {GROUP_BRIEF_ALLOWED_PLACEHOLDERS
            .map((name) => `{${name}}`)
            .join(', ')}. Use {'{scope}'} for groups or selected keywords; legacy {'{group}'} works only with group scope.
        </span>
        <span>{GROUP_BRIEF_MAX_TEMPLATE_LENGTH - prompt.length} characters remaining</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {dirty
          ? 'Edited — generation uses this exact snapshot. Save it to reuse the changes.'
          : 'Generation uses this exact saved template snapshot.'}
      </p>
      <FieldIssue issue={issue} />
    </div>
  );
}

function TemplateActions({
  selectedTemplate,
  dirty,
  disabled,
  saving,
  onSaveAsNew,
  onUpdate,
  onDelete,
}: Pick<GroupBriefPromptEditorProps, 'selectedTemplate' | 'dirty' | 'disabled' | 'saving' | 'onSaveAsNew' | 'onUpdate' | 'onDelete'>) {
  const actionsDisabled = disabled || saving;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void onSaveAsNew()}
        disabled={actionsDisabled}
        className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        Save as new template
      </button>
      {selectedTemplate?.builtin === false ? (
        <>
          <button
            type="button"
            onClick={() => void onUpdate()}
            disabled={actionsDisabled || !dirty}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Update template
          </button>
          <button
            type="button"
            onClick={() => void onDelete()}
            disabled={actionsDisabled}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete template
          </button>
        </>
      ) : (
        <span className="text-xs text-gray-500">
          Built-in templates cannot be edited or deleted; save a copy instead.
        </span>
      )}
      {saving && <Spinner size="sm" />}
    </div>
  );
}

export function GroupBriefPromptEditor({
  mode,
  templates,
  templatesLoading,
  selectedTemplate,
  templateName,
  templateDescription,
  promptTemplate,
  dirty,
  disabled,
  saving,
  issue,
  notice,
  onSelect,
  onNameChange,
  onDescriptionChange,
  onPromptChange,
  onReset,
  onSaveAsNew,
  onUpdate,
  onDelete,
}: GroupBriefPromptEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const compatibleTemplates = templates.filter((template) => template.content_angle === mode);
  const editorDisabled = disabled || saving;
  // The editor also opens by itself when it holds something the user must see: edits, a problem, or a save
  // result. A button (not a native <details>) keeps that forced state from latching the editor open.
  const open = expanded || dirty || issue !== undefined || notice !== undefined;
  return (
    <div className="space-y-3 border-t border-gray-200 pt-4">
      <TemplateSelector
        templates={compatibleTemplates}
        loading={templatesLoading}
        selectedTemplate={selectedTemplate}
        disabled={editorDisabled}
        onSelect={onSelect}
      />
      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setExpanded(!open)}
          className="inline-flex items-center gap-2 rounded text-sm font-medium text-gray-700 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          Customize the prompt
          <span className="font-normal text-gray-500">(optional{dirty ? ', edited' : ''})</span>
        </button>
        <div id={contentId} hidden={!open} className="mt-4 space-y-4">
          <TemplateMetadata
            name={templateName}
            description={templateDescription}
            disabled={editorDisabled}
            onNameChange={onNameChange}
            onDescriptionChange={onDescriptionChange}
          />
          <PromptField
            prompt={promptTemplate}
            dirty={dirty}
            disabled={editorDisabled}
            issue={issue}
            onPromptChange={onPromptChange}
            onReset={onReset}
          />
          <TemplateActions
            selectedTemplate={selectedTemplate}
            dirty={dirty}
            disabled={disabled}
            saving={saving}
            onSaveAsNew={onSaveAsNew}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
          {notice && (
            <output className={`block text-sm ${notice.success ? 'text-emerald-700' : 'text-red-700'}`}>
              {notice.message}
            </output>
          )}
        </div>
      </div>
    </div>
  );
}
