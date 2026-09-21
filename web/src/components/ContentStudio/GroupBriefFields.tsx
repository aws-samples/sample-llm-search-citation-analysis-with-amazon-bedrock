import type {
  ContentBriefScope,
  ContentBriefStrategy,
  GroupBriefMode,
  Keyword,
  KeywordGroup,
} from '../../types';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import type { PendingGeneration } from './GroupBriefForm-logic';
import {
  GROUP_BRIEF_BATCH_MAX_KEYWORDS,
  GROUP_BRIEF_MAX_COPY_LENGTH,
  GROUP_BRIEF_MAX_URL_LENGTH,
  GROUP_BRIEF_MODE_OPTIONS,
  type GroupBriefValidationField,
  type GroupBriefValidationIssue,
} from './GroupBriefForm-source';

export function issueMessage(
  issues: GroupBriefValidationIssue[],
  field: GroupBriefValidationField
): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
}

function selectedScopeName(
  scope: ContentBriefScope,
  groups: KeywordGroup[]
): string {
  if (scope.mode === 'keywords') return 'Selected keywords';
  return groups.find((group) => group.id === scope.group_ids[0])?.name
    ?? 'Selected group';
}

export function ScopePreview({
  scope,
  groups,
  keywords,
}: {
  readonly scope: ContentBriefScope;
  readonly groups: KeywordGroup[];
  readonly keywords: Keyword[];
}) {
  const noun = keywords.length === 1 ? 'keyword' : 'keywords';
  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50 p-4"
      aria-label="Target scope preview"
    >
      <p className="text-sm font-medium text-blue-900">
        {selectedScopeName(scope, groups)}: {keywords.length} active {noun}
      </p>
      {scope.mode === 'groups' && (
        <p className="mt-1 text-xs text-blue-700">
          Group mode always includes every active keyword in the selected group.
        </p>
      )}
      {keywords.length > 0 && (
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-blue-800">
          {keywords.map((keyword) => <li key={keyword.id}>{keyword.keyword}</li>)}
        </ul>
      )}
    </div>
  );
}

interface GenerationModeFieldsProps {
  readonly mode: GroupBriefMode;
  readonly landingUrl: string;
  readonly currentCopy: string;
  readonly disabled: boolean;
  readonly issues: GroupBriefValidationIssue[];
  readonly onModeChange: (mode: GroupBriefMode) => void;
  readonly onLandingUrlChange: (value: string) => void;
  readonly onCurrentCopyChange: (value: string) => void;
}

function LandingUrlField({
  landingUrl,
  disabled,
  issue,
  onChange,
}: {
  readonly landingUrl: string;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="group-brief-url" className="block text-sm font-medium text-gray-900">
        Current landing URL
      </label>
      <input
        id="group-brief-url"
        name="group-brief-url"
        type="url"
        value={landingUrl}
        onChange={(event) => onChange(event.target.value)}
        maxLength={GROUP_BRIEF_MAX_URL_LENGTH}
        placeholder="https://example.com/page"
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      {issue && <p role="alert" className="mt-1 text-sm text-red-600">{issue}</p>}
    </div>
  );
}

function CurrentCopyField({
  currentCopy,
  disabled,
  issue,
  onChange,
}: {
  readonly currentCopy: string;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="group-brief-copy" className="block text-sm font-medium text-gray-900">
        Current copy
      </label>
      <textarea
        id="group-brief-copy"
        name="group-brief-copy"
        value={currentCopy}
        onChange={(event) => onChange(event.target.value)}
        maxLength={GROUP_BRIEF_MAX_COPY_LENGTH}
        rows={8}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      <div className="mt-1 flex justify-between text-xs text-gray-500">
        <span>{issue ?? 'Paste the source copy that should be rewritten.'}</span>
        <span>{GROUP_BRIEF_MAX_COPY_LENGTH - currentCopy.length} characters remaining</span>
      </div>
    </div>
  );
}

export function GenerationModeFields({
  mode,
  landingUrl,
  currentCopy,
  disabled,
  issues,
  onModeChange,
  onLandingUrlChange,
  onCurrentCopyChange,
}: GenerationModeFieldsProps) {
  return (
    <>
      <fieldset className="rounded-xl border border-gray-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-gray-900">Generation mode</legend>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {GROUP_BRIEF_MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              htmlFor={`group-brief-mode-${option.value}`}
              className={`cursor-pointer rounded-lg border p-3 ${
                mode === option.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  id={`group-brief-mode-${option.value}`}
                  type="radio"
                  name="group-brief-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => onModeChange(option.value)}
                  disabled={disabled}
                />
                {option.label}
              </span>
              <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode === 'improve_current_url' && (
        <LandingUrlField
          landingUrl={landingUrl}
          disabled={disabled}
          issue={issueMessage(issues, 'landing_url')}
          onChange={onLandingUrlChange}
        />
      )}
      {mode === 'rewrite_pasted_copy' && (
        <CurrentCopyField
          currentCopy={currentCopy}
          disabled={disabled}
          issue={issueMessage(issues, 'current_copy')}
          onChange={onCurrentCopyChange}
        />
      )}
    </>
  );
}

export function StrategyFields({
  strategy,
  selectedKeywordCount,
  disabled,
  issue,
  onChange,
}: {
  readonly strategy: ContentBriefStrategy;
  readonly selectedKeywordCount: number;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (strategy: ContentBriefStrategy) => void;
}) {
  const estimatedCalls = strategy === 'combined' ? 1 : selectedKeywordCount;
  return (
    <fieldset className="rounded-xl border border-gray-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-gray-900">Brief strategy</legend>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <StrategyOption
          checked={strategy === 'combined'}
          label="Create one brief from this selection"
          description="One background job combines the complete selected scope into one brief."
          disabled={disabled}
          onChange={() => onChange('combined')}
        />
        <StrategyOption
          checked={strategy === 'per_keyword'}
          label="Create a separate brief for each keyword"
          description={`Starts 1–${GROUP_BRIEF_BATCH_MAX_KEYWORDS} independent background jobs in one batch request.`}
          disabled={disabled}
          onChange={() => onChange('per_keyword')}
        />
      </div>
      <p className="mt-3 text-sm font-medium text-gray-800">
        Estimated paid model calls: {estimatedCalls}
      </p>
      {strategy === 'per_keyword' && selectedKeywordCount === 1 && (
        <p className="mt-1 text-xs text-gray-500">
          With one keyword, the combined option is equivalent: either choice starts one background job and one paid model call.
        </p>
      )}
      {issue && <p role="alert" className="mt-2 text-sm text-red-600">{issue}</p>}
    </fieldset>
  );
}

function StrategyOption({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label className={`cursor-pointer rounded-lg border p-3 ${checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}>
      <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <input
          type="radio"
          name="content-brief-strategy"
          aria-label={label}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        {label}
      </span>
      <span className="mt-1 block text-xs text-gray-500">{description}</span>
    </label>
  );
}

export function GenerationConfirmation({
  pending,
  generating,
  onClose,
  onConfirm,
}: {
  readonly pending: PendingGeneration | null;
  readonly generating: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
}) {
  const jobCount = pending?.strategy === 'per_keyword'
    ? pending.selectedKeywordCount
    : 1;
  const jobNoun = jobCount === 1 ? 'job' : 'jobs';
  const callNoun = jobCount === 1 ? 'call' : 'calls';
  return (
    <Modal
      isOpen={pending !== null}
      onClose={onClose}
      title="Confirm Content Brief generation"
      showCloseButton={false}
    >
      <p className="text-sm text-gray-700">
        This will start {jobCount} background {jobNoun} and make {jobCount} paid model {callNoun}.
      </p>
      <p className="mt-2 text-xs text-gray-500">
        Generation continues in the background after this request is accepted.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={generating}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {generating && <Spinner size="sm" />}
          {generating ? 'Starting...' : `Start ${jobCount} ${jobNoun}`}
        </button>
      </div>
    </Modal>
  );
}
