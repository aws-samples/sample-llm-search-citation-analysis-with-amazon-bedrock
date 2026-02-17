import { Spinner } from '../ui/Spinner';
import type { Keyword } from '../../types';

interface TriggerSectionProps {
  selectedKeywords: string[];
  keywordsCount: number;
  activeKeywords: Keyword[];
  isRunning: boolean;
  isStarting: boolean;
  onSelectAll: () => void;
  onToggleKeyword: (keyword: string) => void;
  onTriggerAnalysis: () => void;
}

export const TriggerSection = ({
  selectedKeywords,
  keywordsCount,
  activeKeywords,
  isRunning,
  isStarting,
  onSelectAll,
  onToggleKeyword,
  onTriggerAnalysis,
}: TriggerSectionProps) => {
  const keywordSuffix = selectedKeywords.length > 1 ? 's' : '';
  const keywordCountText = selectedKeywords.length > 0
    ? `${selectedKeywords.length} keyword${keywordSuffix} selected`
    : `All ${keywordsCount} active keywords`;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 className="text-sm font-medium text-gray-900 mb-2">Run Citation Analysis</h2>
      <p className="text-sm text-gray-500 mb-4">{keywordCountText}</p>

      {activeKeywords.length > 0 && (
        <KeywordSelector
          activeKeywords={activeKeywords}
          selectedKeywords={selectedKeywords}
          onSelectAll={onSelectAll}
          onToggleKeyword={onToggleKeyword}
        />
      )}

      <TriggerButton
        keywordsCount={keywordsCount}
        isRunning={isRunning}
        isStarting={isStarting}
        onTriggerAnalysis={onTriggerAnalysis}
      />
    </div>
  );
};

interface KeywordSelectorProps {
  activeKeywords: Keyword[];
  selectedKeywords: string[];
  onSelectAll: () => void;
  onToggleKeyword: (keyword: string) => void;
}

const KeywordSelector = ({
  activeKeywords,
  selectedKeywords,
  onSelectAll,
  onToggleKeyword,
}: KeywordSelectorProps) => (
  <div className="mb-4">
    <div className="flex justify-between items-center mb-3">
      <label className="text-sm text-gray-600">Select keywords (optional)</label>
      <button onClick={onSelectAll} className="text-sm text-gray-600 hover:text-gray-900">
        {selectedKeywords.length === activeKeywords.length ? 'Deselect all' : 'Select all'}
      </button>
    </div>
    <div className="max-h-60 sm:max-h-80 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {activeKeywords.map((kw) => (
          <label
            key={kw.keyword}
            className="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={selectedKeywords.includes(kw.keyword)}
              onChange={() => onToggleKeyword(kw.keyword)}
              className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700 truncate">{kw.keyword}</span>
          </label>
        ))}
      </div>
    </div>
  </div>
);

interface TriggerButtonProps {
  keywordsCount: number;
  isRunning: boolean;
  isStarting: boolean;
  onTriggerAnalysis: () => void;
}

const TriggerButton = ({
  keywordsCount,
  isRunning,
  isStarting,
  onTriggerAnalysis,
}: TriggerButtonProps) => (
  <>
    <button
      onClick={onTriggerAnalysis}
      disabled={keywordsCount === 0 || isRunning || isStarting}
      className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
    >
      {isStarting ? (
        <>
          <Spinner size="sm" />
          Starting...
        </>
      ) : (
        <>
          <PlayIcon />
          Start Analysis
        </>
      )}
    </button>

    {keywordsCount === 0 && <p className="text-sm text-red-600 mt-2">Add keywords first</p>}
    {isRunning && <RunningIndicator />}
  </>
);

const PlayIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const RunningIndicator = () => (
  <p className="text-sm text-gray-500 mt-2 flex items-center gap-2">
    <span className="flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
    </span>
    Analysis running...
  </p>
);