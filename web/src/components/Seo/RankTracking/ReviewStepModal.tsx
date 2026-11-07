import {
  useState, type ReactNode
} from 'react';
import { seoErrorMessage } from '../../../api/seo';
import type { RankEstimate } from '../../../types/api/seoRankTracking';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { Modal } from '../../ui/Modal';

/** A request of a review modal: running, or settled with the refusal's message. */
export interface ReviewRequest {
  readonly busy: boolean;
  readonly error: string | null;
}

const SETTLED: ReviewRequest = {
  busy: false,
  error: null,
};
const BUSY: ReviewRequest = {
  busy: true,
  error: null,
};

/**
 * The state of a review modal: the estimate under review (`null` on the form) and one request at a time;
 * `attempt` marks the request busy, then settled with the failure's message, if any.
 */
export function useReviewStep(): {
  readonly estimate: RankEstimate | null;
  readonly setEstimate: (estimate: RankEstimate | null) => void;
  readonly request: ReviewRequest;
  readonly attempt: (action: () => Promise<void>) => void;
} {
  const [estimate, setEstimate] = useState<RankEstimate | null>(null);
  const [request, setRequest] = useState<ReviewRequest>(SETTLED);
  const attempt = (action: () => Promise<void>) => {
    setRequest(BUSY);
    action().then(
      () => setRequest(SETTLED),
      (failure: unknown) => setRequest({
        busy: false,
        error: seoErrorMessage(failure),
      }),
    );
  };
  return {
    estimate,
    setEstimate,
    request,
    attempt,
  };
}

interface Props {
  readonly title: string;
  readonly request: ReviewRequest;
  /** True once the free estimate is shown and the paid action waits for confirmation. */
  readonly reviewing: boolean;
  /** Whether the form can be reviewed (ignored while reviewing). */
  readonly canReview: boolean;
  readonly confirmLabel: string;
  readonly onClose: () => void;
  readonly onBack: () => void;
  readonly onReview: () => void;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}

/**
 * A two-step tracker modal: the form with Cancel + Review, then the free estimate with Back + confirm.
 * Nothing paid happens before the confirm button.
 */
export function ReviewStepModal({
  title, request, reviewing, canReview, confirmLabel, onClose, onBack, onReview, onConfirm, children
}: Props) {
  return (
    <Modal isOpen onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        {children}
        {request.error !== null && <ErrorAlert message={request.error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={reviewing ? onBack : onClose}>
            {reviewing ? 'Back' : 'Cancel'}
          </Button>
          {reviewing ? (
            <Button disabled={request.busy} onClick={onConfirm}>{confirmLabel}</Button>
          ) : (
            <Button disabled={request.busy || !canReview} onClick={onReview}>Review</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
