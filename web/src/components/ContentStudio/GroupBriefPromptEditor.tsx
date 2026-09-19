import type { GroupBriefMode } from '../../types';
import {
  GROUP_BRIEF_ALLOWED_PLACEHOLDERS,
  GROUP_BRIEF_DEFAULT_TEMPLATES,
  GROUP_BRIEF_MAX_TEMPLATE_LENGTH,
} from './GroupBriefForm-source';

interface GroupBriefPromptEditorProps {
  readonly mode: GroupBriefMode;
  readonly promptTemplate: string;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (promptTemplate: string) => void;
}

export function GroupBriefPromptEditor({
  mode,
  promptTemplate,
  disabled,
  issue,
  onChange,
}: GroupBriefPromptEditorProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="group-brief-template" className="text-sm font-medium text-gray-900">
          Prompt template
        </label>
        <button
          type="button"
          onClick={() => onChange(GROUP_BRIEF_DEFAULT_TEMPLATES[mode])}
          disabled={disabled}
          className="text-sm font-medium text-gray-700 hover:text-gray-900 disabled:text-gray-400"
        >
          Reset to default
        </button>
      </div>
      <textarea
        id="group-brief-template"
        value={promptTemplate}
        onChange={(event) => onChange(event.target.value)}
        maxLength={GROUP_BRIEF_MAX_TEMPLATE_LENGTH}
        rows={12}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      <div className="flex flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:justify-between">
        <span>
          Allowed placeholders: {GROUP_BRIEF_ALLOWED_PLACEHOLDERS
            .map((name) => `{${name}}`)
            .join(', ')}
        </span>
        <span>
          {GROUP_BRIEF_MAX_TEMPLATE_LENGTH - promptTemplate.length} characters remaining
        </span>
      </div>
      {issue && <p role="alert" className="text-sm text-red-600">{issue}</p>}
    </div>
  );
}
