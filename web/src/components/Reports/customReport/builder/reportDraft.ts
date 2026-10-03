import {
  MAX_CUSTOM_REPORTS, MAX_REPORT_BLOCKS, MAX_REPORT_TITLE_LENGTH, type CustomReportInput, type ReportBlock
} from '../../../../api/customReports';
import {
  ApiRequestError, getErrorMessage
} from '../../../../infrastructure';
import { blockName } from '../blockCatalog';
import {
  contentBlockPayload, contentBlockProblem, isContentBlock
} from '../content/contentBlocks';
import type { ReportDraft } from './useReportDraft';

/** The first thing the server would refuse in `draft`, as a sentence; `null` when it would save. */
export function draftProblem(draft: ReportDraft): string | null {
  const title = draft.title.trim();
  if (title === '') return 'Give the report a name.';
  if (title.length > MAX_REPORT_TITLE_LENGTH) return `Keep the name under ${MAX_REPORT_TITLE_LENGTH} characters.`;
  if (draft.items.length === 0) return 'Add at least one block.';
  if (draft.items.length > MAX_REPORT_BLOCKS) return `A report holds at most ${MAX_REPORT_BLOCKS} blocks.`;
  for (const [index, { block }] of draft.items.entries()) {
    const problem = isContentBlock(block) ? contentBlockProblem(block) : null;
    if (problem !== null) return `Block ${index + 1} (${blockName(block.type)}): ${problem}.`;
  }
  return null;
}

/** What the server stores for `block`: a content block's own fields, a report section's type alone. */
function blockPayload(block: ReportBlock): ReportBlock {
  return isContentBlock(block) ? contentBlockPayload(block) : { type: block.type };
}

export function draftInput(draft: ReportDraft): CustomReportInput {
  return {
    title: draft.title.trim(),
    blocks: draft.items.map(({ block }) => blockPayload(block)),
    days: draft.days,
  };
}

/** Why a save failed, in words the reader can act on. */
export function saveFailureMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.statusCode === 409) {
    return `There are already ${MAX_CUSTOM_REPORTS} saved reports. Delete one to save another.`;
  }
  if (error instanceof ApiRequestError && error.statusCode === 404) {
    return 'This report was deleted in the meantime. Use Save as new report to keep your changes.';
  }
  return getErrorMessage(error);
}
