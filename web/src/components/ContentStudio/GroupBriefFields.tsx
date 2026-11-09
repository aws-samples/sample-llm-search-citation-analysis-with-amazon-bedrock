import type { GroupBriefMode } from '../../types';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import type { PendingGeneration } from './GroupBriefForm-logic';
import {
  GROUP_BRIEF_MAX_COPY_LENGTH,
  GROUP_BRIEF_MAX_URL_LENGTH,
  GROUP_BRIEF_MODE_OPTIONS,
  type GroupBriefValidationField,
  type GroupBriefValidationIssue,
} from './GroupBriefForm-source';

/** A selectable option card (radio inside a label); the selected one takes the interaction colour. */
export const OPTION_CARD_CLASS = 'block cursor-pointer rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-gray-900 dark:focus-within:ring-gray-300';
export const OPTION_CARD_SELECTED = 'border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:border-blue-400 dark:ring-blue-400';
export const OPTION_CARD_IDLE = 'border-gray-200 bg-white hover:border-gray-300 dark:hover:border-gray-500';

export function issueMessage(
  issues: GroupBriefValidationIssue[],
  field: GroupBriefValidationField
): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
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

interface SourceFieldProps {
  readonly value: string;
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (value: string) => void;
}

/** Validation message under a field, announced when it appears. */
export function FieldIssue({ issue }: { readonly issue?: string }) {
  return issue ? <p role="alert" className="mt-1 text-sm text-red-700">{issue}</p> : null;
}

function LandingUrlField({
  value: landingUrl,
  disabled,
  issue,
  onChange,
}: SourceFieldProps) {
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
      <FieldIssue issue={issue} />
    </div>
  );
}

function CurrentCopyField({
  value: currentCopy,
  disabled,
  issue,
  onChange,
}: SourceFieldProps) {
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
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Generation mode</legend>
        <div className="grid gap-3 lg:grid-cols-3">
          {GROUP_BRIEF_MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              htmlFor={`group-brief-mode-${option.value}`}
              className={`${OPTION_CARD_CLASS} ${mode === option.value ? OPTION_CARD_SELECTED : OPTION_CARD_IDLE}`}
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
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-gray-900"
                />
                {option.label}
              </span>
              <span className="mt-1 block pl-6 text-xs text-gray-500">{option.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode === 'improve_current_url' && (
        <LandingUrlField
          value={landingUrl}
          disabled={disabled}
          issue={issueMessage(issues, 'landing_url')}
          onChange={onLandingUrlChange}
        />
      )}
      {mode === 'rewrite_pasted_copy' && (
        <CurrentCopyField
          value={currentCopy}
          disabled={disabled}
          issue={issueMessage(issues, 'current_copy')}
          onChange={onCurrentCopyChange}
        />
      )}
    </>
  );
}

export function GenerationConfirmation({
  pending,
  generating,
  onClose,
  onConfirm,
  summary,
}: {
  /** What the brief writes, for which keywords and in which language. */
  readonly summary: string;
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
      <p className="break-words text-sm font-medium text-gray-900">{summary}</p>
      <p className="mt-2 text-sm text-gray-700">
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
