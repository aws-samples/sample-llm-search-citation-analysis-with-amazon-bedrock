import type { ReextractEstimate } from '../../../api/reextractDecoders';
import {
  integerText, usdText
} from '../../ui/numberFormat';

/** `1,210 answers in 85 keywords · about $3.42 of Bedrock`. */
export function estimateSummary(estimate: ReextractEstimate): string {
  return `${integerText(estimate.answers)} answers in ${integerText(estimate.keywords)} keywords`
    + ` · about ${usdText(estimate.estimated_cost_usd)} of Bedrock`;
}

interface ReextractEstimateLineProps {
  readonly estimate: ReextractEstimate;
  /** The filters changed since this estimate: it no longer describes them. */
  readonly outdated: boolean;
}

/** What the last estimate counted, with the answers already current and a note when the count was cut short. */
export function ReextractEstimateLine({
  estimate, outdated
}: ReextractEstimateLineProps) {
  return (
    <div className="space-y-1 text-sm" aria-live="polite">
      <p className={outdated ? 'text-gray-500' : 'font-medium text-gray-900'}>
        {estimateSummary(estimate)}
        {estimate.answers_current > 0 && ` · ${integerText(estimate.answers_current)} already current`}
      </p>
      {estimate.truncated && (
        <p className="text-amber-700">The count stopped at the request time limit: there are at least this many answers.</p>
      )}
      {outdated && <p className="text-gray-500">The filters changed. Estimate again to re-extract.</p>}
    </div>
  );
}
