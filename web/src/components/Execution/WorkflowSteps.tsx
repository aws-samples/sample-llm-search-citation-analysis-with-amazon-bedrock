import type {
  KeywordProgress, StepState
} from '../../formatting/executionProcessor';
import {
  CheckIcon, CloseIcon
} from '../ui/Icons';
import { Spinner } from '../ui/Spinner';
import {
  describeKeywordProgress, stepWords
} from './runOutcome';

const MARKER_BASE = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold';

const MARKER_STYLES: Record<StepState['status'], string> = {
  pending: 'border border-gray-300 bg-white text-gray-500 dark:border-gray-600',
  running: 'border-2 border-gray-900 bg-white text-gray-900 dark:border-gray-100',
  completed: 'bg-gray-900 text-white',
  failed: 'bg-red-600 text-white',
};

/** Spelled out under every step so its state never depends on the marker alone. */
const STEP_STATUS_LABELS: Record<StepState['status'], string> = {
  pending: 'Pending',
  running: 'In progress',
  completed: 'Done',
  failed: 'Failed',
};

const STATUS_TEXT: Record<StepState['status'], string> = {
  pending: 'text-gray-500',
  running: 'text-gray-900 font-medium',
  completed: 'text-emerald-700',
  failed: 'text-red-700 font-medium',
};

const StepMarker = ({
  status, position
}: {
  readonly status: StepState['status'];
  readonly position: number 
}) => {
  const icon = {
    completed: <CheckIcon className="h-4 w-4" />,
    failed: <CloseIcon className="h-4 w-4" />,
    running: <Spinner size="sm" />,
    pending: <span>{position}</span>,
  }[status];
  return <span aria-hidden="true" className={`${MARKER_BASE} ${MARKER_STYLES[status]}`}>{icon}</span>;
};

/** A thin neutral bar; the track and value are styled per engine (WebKit/Blink and Firefox). */
const PROGRESS_CLASS = [
  'block h-1.5 w-full max-w-[16rem] appearance-none overflow-hidden rounded-full border-0 bg-gray-200',
  '[&::-webkit-progress-bar]:bg-gray-200 dark:[&::-webkit-progress-bar]:bg-gray-700',
  '[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-gray-900 dark:[&::-webkit-progress-value]:bg-gray-100',
  '[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-gray-900 dark:[&::-moz-progress-bar]:bg-gray-100',
].join(' ');

interface KeywordProgressBarProps { readonly keywords: KeywordProgress; }

/** The keyword step's counts as a bar and in words: done = succeeded + failed. */
const KeywordProgressBar = ({ keywords }: KeywordProgressBarProps) => {
  const done = keywords.keywords_succeeded + keywords.keywords_failed;
  return (
    <div className="mt-2">
      <progress
        aria-label="Keywords done"
        max={Math.max(keywords.keywords_total, 1)}
        value={done}
        className={PROGRESS_CLASS}
      />
      <p className="mt-1 text-xs text-gray-600">{describeKeywordProgress(keywords)}</p>
    </div>
  );
};

interface WorkflowStepsProps { readonly steps: StepState[]; }

/**
 * The run's steps as a numbered stepper in plain words: a marker (number,
 * spinner, check or cross), the step name and its state in words, and on
 * the keyword step a bar of keywords done.
 */
export const WorkflowSteps = ({ steps }: WorkflowStepsProps) => (
  <ol aria-label="Run steps" className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
    {steps.map((step, index) => (
      <li key={step.name} className="flex min-w-0 gap-3 sm:flex-col sm:gap-2">
        <div className="flex items-center gap-2 sm:w-full">
          <StepMarker status={step.status} position={index + 1} />
          {index < steps.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-gray-200 sm:block" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{stepWords(step.name).label}</p>
          <p className={`text-xs ${STATUS_TEXT[step.status]}`}>{STEP_STATUS_LABELS[step.status]}</p>
          {step.keywords && <KeywordProgressBar keywords={step.keywords} />}
        </div>
      </li>
    ))}
  </ol>
);
