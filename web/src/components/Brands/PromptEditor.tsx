import { Button } from '../ui';

interface PromptEditorProps {
  /** Display name of the industry whose prompt this is; the industry is picked in the form header. */
  readonly industryName: string;
  /** The industry has a saved custom prompt. */
  readonly hasCustomPrompt: boolean;
  readonly currentPrompt: string;
  readonly promptModified: boolean;
  readonly onPromptChange: (prompt: string) => void;
  readonly onResetToDefault: () => void;
}

const TEMPLATE_VARIABLES = ['{{TRACKED_BRANDS}}', '{{SENTIMENT_FIELDS}}', '{{RANKING_CONTEXT_FIELD}}', '{{TEXT}}'];
const BADGE = 'rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700';

/** The extraction prompt of the selected industry: template variables, the editor, and reset to the preset. */
export const PromptEditor = ({
  industryName,
  hasCustomPrompt,
  currentPrompt,
  promptModified,
  onPromptChange,
  onResetToDefault,
}: PromptEditorProps) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="brands-extraction-prompt" className="text-sm font-semibold text-gray-900">
        Extraction prompt for {industryName}
      </label>
      <div className="flex items-center gap-2">
        {promptModified && <span className={BADGE}>Unsaved</span>}
        {hasCustomPrompt && <span className={BADGE}>Custom</span>}
      </div>
    </div>
    <p className="text-sm text-gray-600">
      Template variables:{' '}
      {TEMPLATE_VARIABLES.map((variable) => (
        <code key={variable} className="mr-1.5 rounded-sm border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{variable}</code>
      ))}
    </p>
    <textarea
      id="brands-extraction-prompt"
      value={currentPrompt}
      onChange={(e) => onPromptChange(e.target.value)}
      className="h-80 w-full rounded-lg border border-gray-300 bg-white p-4 font-mono text-sm text-gray-900 focus:ring-2 focus:ring-gray-900"
      placeholder="Enter extraction prompt..."
      spellCheck={false}
    />
    <div className="flex items-center justify-between">
      <Button variant="secondary" size="sm" onClick={onResetToDefault}>Reset to default</Button>
      <span className="text-sm text-gray-500">{currentPrompt.length} chars</span>
    </div>
  </div>
);
