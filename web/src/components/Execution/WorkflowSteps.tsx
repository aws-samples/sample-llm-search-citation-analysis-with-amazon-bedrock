import type {
  KeywordProgress, StepState
} from '../../formatting/executionProcessor';

const STEP_STYLES: Record<StepState['status'], string> = {
  pending: 'border-gray-200 bg-gray-50',
  running: 'border-gray-400 bg-gray-50',
  completed: 'border-emerald-400 bg-emerald-50',
  failed: 'border-red-400 bg-red-50',
};

const STEP_INDICATORS: Record<StepState['status'], string> = {
  pending: 'bg-gray-300',
  running: 'bg-gray-500 animate-pulse',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

/** Spelled out under every step so its state never depends on the dot colour alone. */
const STEP_STATUS_LABELS: Record<StepState['status'], string> = {
  pending: 'Pending',
  running: 'In progress',
  completed: 'Done',
  failed: 'Failed',
};

interface WorkflowStepsProps { steps: StepState[]; }

export const WorkflowSteps = ({ steps }: WorkflowStepsProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200 bg-gray-50">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
      <h3 className="text-sm font-medium text-gray-900">Workflow</h3>
      <StepLegend />
    </div>
    <ol className="flex items-center gap-2 overflow-x-auto pb-2">
      {steps.map((step, idx) => (
        <StepItem key={step.name} step={step} isLast={idx === steps.length - 1} />
      ))}
    </ol>
  </div>
);

const StepLegend = () => (
  <div className="flex items-center gap-3 sm:gap-4 text-xs text-gray-500" aria-hidden="true">
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-gray-300 rounded-full"></div><span>Pending</span></div>
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div><span>Running</span></div>
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-500 rounded-full"></div><span>Done</span></div>
  </div>
);

interface StepItemProps {
  step: StepState;
  isLast: boolean;
}

const StepItem = ({
  step, isLast
}: StepItemProps) => (
  <li className="flex items-center">
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border min-w-[140px] ${STEP_STYLES[step.status]}`}>
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STEP_INDICATORS[step.status]}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate">{step.name}</p>
        {step.description && <p className="text-xs text-gray-400">{step.description}</p>}
        <p className="text-xs text-gray-500">{STEP_STATUS_LABELS[step.status]}</p>
        {step.keywords && <KeywordProgressText keywords={step.keywords} />}
      </div>
    </div>
    {!isLast && <div className="w-6 h-px bg-gray-300 mx-1" aria-hidden="true" />}
  </li>
);

interface KeywordProgressTextProps { keywords: KeywordProgress; }

/** "<done> of <total> keywords", done = succeeded + failed; the failed count follows when there is one. */
const KeywordProgressText = ({ keywords }: KeywordProgressTextProps) => {
  const done = keywords.keywords_succeeded + keywords.keywords_failed;
  return (
    <>
      <p className="text-xs text-gray-600">
        {`${done.toLocaleString()} of ${keywords.keywords_total.toLocaleString()} keywords`}
      </p>
      {keywords.keywords_failed > 0 && (
        <p className="text-xs text-red-700">{`${keywords.keywords_failed.toLocaleString()} failed`}</p>
      )}
    </>
  );
};
