/**
 * Keyword entry workflow logic for KeywordsManager (bugs.md §5 split):
 * response parsing, duplicate detection, bulk-input parsing, per-keyword
 * submission, and result/message aggregation. Everything here is either
 * pure or a thin api-client composition, so it unit-tests without React.
 */

import { apiPost } from '../../api/client';
import { isDefinitiveClientRejection } from '../../infrastructure';
import type { Keyword } from '../../types';
import { isKeyword } from '../../types/domain/keywordDecoders';
import type { AlertState } from '../../hooks/useAlertModal';

export interface BulkFailure {
  keyword: string;
  message: string;
}

export type BulkKeywordResult =
  | {
    outcome: 'success';
    data: Keyword;
  }
  | {
    outcome: 'failure';
    failure: BulkFailure;
  };

export const CREATE_ERROR_MESSAGE = 'Failed to add keyword';
export const UPDATE_ERROR_MESSAGE = 'Failed to update keyword';
export const DELETE_ERROR_MESSAGE = 'Failed to delete keyword';

export class InvalidKeywordResponseError extends TypeError {
  constructor() {
    super('Keyword API returned a malformed success payload');
    this.name = 'InvalidKeywordResponseError';
  }
}

export function parseKeywordResponse(value: unknown): Keyword {
  if (!isKeyword(value)) {
    throw new InvalidKeywordResponseError();
  }

  return value;
}

export function getSafeErrorMessage(error: unknown, fallback: string): string {
  // Shared policy (bugs.md 4.2): server text only for definitive client
  // rejections. This route keeps its local operation-specific fallbacks
  // instead of the generic category messages.
  if (
    isDefinitiveClientRejection(error) &&
    typeof error.responseMessage === 'string' &&
    error.responseMessage.length > 0
  ) {
    return error.responseMessage;
  }
  return fallback;
}

/**
 * Case-insensitive duplicate check against the current keyword list.
 * `excludeId` skips the keyword being edited so renames don't match themselves.
 */
export function isDuplicateKeyword(
  candidate: string,
  existing: Keyword[],
  excludeId?: string
): boolean {
  const normalized = candidate.trim().toLowerCase();
  return existing.some(
    (item) => item.id !== excludeId && item.keyword.toLowerCase() === normalized
  );
}

export function parseBulkKeywords(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split('\n')
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      if (keyword.length === 0) return false;
      const normalized = keyword.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export async function processBulkKeyword(keyword: string): Promise<BulkKeywordResult> {
  try {
    const response = await apiPost<unknown>(
      '/keywords',
      { keyword },
      { allowStructured4xx: true }
    );
    return {
      outcome: 'success',
      data: parseKeywordResponse(response),
    };
  } catch (error) {
    console.error(`Error adding bulk keyword "${keyword}":`, error);
    return {
      outcome: 'failure',
      failure: {
        keyword,
        message: getSafeErrorMessage(error, CREATE_ERROR_MESSAGE),
      },
    };
  }
}

export function collectBulkResults(results: BulkKeywordResult[]): {
  addedKeywords: Keyword[];
  failures: BulkFailure[];
} {
  const addedKeywords: Keyword[] = [];
  const failures: BulkFailure[] = [];

  results.forEach((result) => {
    if (result.outcome === 'success') {
      addedKeywords.push(result.data);
    } else {
      failures.push(result.failure);
    }
  });

  return {
    addedKeywords,
    failures,
  };
}

export function getBulkAlert(
  addedCount: number,
  failureCount: number
): Pick<AlertState, 'title' | 'variant'> {
  if (failureCount === 0) {
    return {
      title: 'Success',
      variant: 'success',
    };
  }
  if (addedCount > 0) {
    return {
      title: 'Partial Success',
      variant: 'info',
    };
  }
  return {
    title: 'Error',
    variant: 'error',
  };
}

export function buildBulkMessage(
  addedCount: number,
  duplicateCount: number,
  failures: BulkFailure[]
): string {
  const messages: string[] = [];

  if (addedCount > 0) {
    messages.push(`Added ${addedCount} ${addedCount === 1 ? 'keyword' : 'keywords'}`);
  }
  if (duplicateCount > 0) {
    messages.push(`Skipped ${duplicateCount} ${duplicateCount === 1 ? 'duplicate' : 'duplicates'}`);
  }
  if (failures.length > 0) {
    const details = failures
      .map(({
        keyword,
        message,
      }) => `${keyword} (${message})`)
      .join(', ');
    messages.push(`Failed: ${details}`);
  }

  return messages.join('. ');
}
