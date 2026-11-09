import type { ContentBriefStrategy } from '../../types';
import { Button } from '../ui/Button';
import {
  FieldIssue, OPTION_CARD_CLASS, OPTION_CARD_IDLE, OPTION_CARD_SELECTED
} from './GroupBriefFields';
import {
  GROUP_BRIEF_BATCH_MAX_KEYWORDS, GROUP_BRIEF_LANGUAGES
} from './GroupBriefForm-source';

interface StrategyOptionProps {
  readonly checked: boolean;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onChange: () => void;
}

function StrategyOption({
  checked, label, description, disabled, onChange
}: StrategyOptionProps) {
  return (
    <label className={`${OPTION_CARD_CLASS} ${checked ? OPTION_CARD_SELECTED : OPTION_CARD_IDLE}`}>
      <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <input
          type="radio"
          name="content-brief-strategy"
          aria-label={label}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-gray-900"
        />
        {label}
      </span>
      <span className="mt-1 block pl-6 text-xs text-gray-500">{description}</span>
    </label>
  );
}

interface BriefReviewFieldsProps {
  readonly strategy: ContentBriefStrategy;
  readonly selectedKeywordCount: number;
  readonly outputLanguage: string;
  /** What the brief writes, for whom and in which language, in one line. */
  readonly summary: string;
  readonly disabled: boolean;
  readonly submitDisabled: boolean;
  readonly strategyIssue?: string;
  readonly onStrategyChange: (strategy: ContentBriefStrategy) => void;
  readonly onLanguageChange: (language: string) => void;
}

/**
 * Step 3 of the Content Brief: how many briefs, the language, then one summary
 * panel with the paid-call estimate beside the single primary action. The
 * action opens the cost confirmation; nothing starts before it.
 */
export function BriefReviewFields({
  strategy, selectedKeywordCount, outputLanguage, summary, disabled, submitDisabled, strategyIssue,
  onStrategyChange, onLanguageChange,
}: BriefReviewFieldsProps) {
  const estimatedCalls = strategy === 'combined' ? 1 : selectedKeywordCount;
  return (
    <>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 block text-sm font-medium text-gray-900">Brief strategy</legend>
        <div className="grid gap-3 lg:grid-cols-2">
          <StrategyOption
            checked={strategy === 'combined'}
            label="Create one brief from this selection"
            description="One background job combines every selected keyword into one brief."
            disabled={disabled}
            onChange={() => onStrategyChange('combined')}
          />
          <StrategyOption
            checked={strategy === 'per_keyword'}
            label="Create a separate brief for each keyword"
            description={`One background job per keyword, for 1–${GROUP_BRIEF_BATCH_MAX_KEYWORDS} keywords.`}
            disabled={disabled}
            onChange={() => onStrategyChange('per_keyword')}
          />
        </div>
        {strategy === 'per_keyword' && selectedKeywordCount === 1 && (
          <p className="mt-2 text-xs text-gray-500">
            With one keyword, the combined option is equivalent: either choice starts one background job and one paid model call.
          </p>
        )}
        <FieldIssue issue={strategyIssue} />
      </fieldset>

      <div className="sm:max-w-xs">
        <label htmlFor="group-brief-language" className="block text-sm font-medium text-gray-900">
          Output language
        </label>
        <select
          id="group-brief-language"
          name="group-brief-language"
          value={outputLanguage}
          onChange={(event) => onLanguageChange(event.target.value)}
          disabled={disabled}
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
        >
          {GROUP_BRIEF_LANGUAGES.map((language) => (
            <option key={language} value={language}>{language}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <output aria-live="polite" className="block break-words text-sm text-gray-900">{summary}</output>
          <p className="mt-1 text-sm font-medium text-gray-900">Estimated paid model calls: {estimatedCalls}</p>
          <p className="mt-0.5 text-xs text-gray-500">You confirm the cost in the next step before anything starts.</p>
        </div>
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          Review generation
        </Button>
      </div>
    </>
  );
}
