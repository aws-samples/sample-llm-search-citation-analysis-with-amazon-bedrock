import type { IndustryPresets } from '../../types';

interface PromptEditorProps {
  readonly industry: string;
  readonly presets: IndustryPresets | null;
  readonly industryPrompts: Record<string, string>;
  readonly currentPrompt: string;
  readonly promptModified: boolean;
  readonly onIndustryChange: (industry: string) => void;
  readonly onPromptChange: (prompt: string) => void;
  readonly onResetToDefault: () => void;
}

export const PromptEditor = ({
  industry,
  presets,
  industryPrompts,
  currentPrompt,
  promptModified,
  onIndustryChange,
  onPromptChange,
  onResetToDefault,
}: PromptEditorProps) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Industry:</span>
          <select value={industry} onChange={(e) => onIndustryChange(e.target.value)} className="p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 bg-white text-sm">
            {presets && Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>{preset.name}{industryPrompts[key] ? ' ✓' : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {promptModified && (<span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">Unsaved</span>)}
          {industryPrompts[industry] && (<span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Custom</span>)}
        </div>
      </div>

      <div className="bg-gray-100 border border-gray-200 rounded-lg p-3">
        <p className="text-xs text-gray-600 mb-2">Template variables:</p>
        <div className="flex flex-wrap gap-2">
          <code className="text-xs bg-white px-2 py-1 rounded border">{'{{TRACKED_BRANDS}}'}</code>
          <code className="text-xs bg-white px-2 py-1 rounded border">{'{{SENTIMENT_FIELDS}}'}</code>
          <code className="text-xs bg-white px-2 py-1 rounded border">{'{{RANKING_CONTEXT_FIELD}}'}</code>
          <code className="text-xs bg-white px-2 py-1 rounded border">{'{{TEXT}}'}</code>
        </div>
      </div>

      <textarea
        value={currentPrompt}
        onChange={(e) => onPromptChange(e.target.value)}
        className="w-full h-80 p-4 font-mono text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 bg-gray-900 text-gray-100"
        placeholder="Enter extraction prompt..."
        spellCheck={false}
      />

      <div className="flex justify-between items-center">
        <button onClick={onResetToDefault} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Reset to Default
        </button>
        <span className="text-xs text-gray-500">{currentPrompt.length} chars</span>
      </div>
    </div>
  );
};
