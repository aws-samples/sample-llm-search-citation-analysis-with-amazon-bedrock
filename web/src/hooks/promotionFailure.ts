/**
 * What a failed promotion tells the user, and whether the active keywords
 * must be re-read because the server may still have written some of them.
 */
import { IncompletePromotionError } from '../api/keywords';
import {
  clientRejectionMessage, getErrorMessage, isAbortError, isDefinitiveClientRejection
} from '../infrastructure';

export const PROMOTION_TIMEOUT_MESSAGE =
  'Adding keywords did not return within 30 seconds. The server may still finish; active keywords are being refreshed.';

interface PromotionFailure {
  message: string;
  /** Whether the server may still have completed the request, so the active keywords must be re-read. */
  reconcile: boolean;
}

export function describePromotionFailure(requestError: unknown): PromotionFailure {
  // What the rounds did write is applied (and reconciled) by the caller.
  if (requestError instanceof IncompletePromotionError) {
    return {
      message: requestError.message,
      reconcile: false,
    };
  }
  if (isAbortError(requestError)) {
    return {
      message: PROMOTION_TIMEOUT_MESSAGE,
      reconcile: true,
    };
  }
  if (isDefinitiveClientRejection(requestError)) {
    return {
      message: clientRejectionMessage(requestError, 'keywords', { includeField: true }),
      reconcile: false,
    };
  }
  return {
    message: `Adding keywords failed to return a confirmed result: ${getErrorMessage(requestError, 'keywords')}. The server may still have completed; active keywords are being refreshed.`,
    reconcile: true,
  };
}
