import {
  beforeEach, vi
} from 'vitest';
import { useContentBriefTemplates } from '../../hooks/useContentBriefTemplates';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type { GroupBriefIdea } from '../../types';
import {
  buildContentBriefTemplatesHookResult,
  buildKeywordGroupHookResult,
  renderGroupBriefForm,
  selectGroupForBrief,
  submitGroupBrief,
} from './GroupBriefForm-fixtures';

/**
 * Before each test, the auto-mocked `useKeywordGroups` and
 * `useContentBriefTemplates` return two keyword groups and the built-in
 * templates. The calling spec auto-mocks both hooks with `vi.mock`.
 */
export function setupGroupBriefHookMocks(): void {
  beforeEach(() => {
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupHookResult());
    vi.mocked(useContentBriefTemplates).mockReturnValue(
      buildContentBriefTemplatesHookResult()
    );
  });
}

export async function submitGroupBriefTwice(
  onGenerate: (idea: GroupBriefIdea) => Promise<boolean>
): Promise<void> {
  renderGroupBriefForm({ onGenerate });
  await selectGroupForBrief();
  await submitGroupBrief();
  await submitGroupBrief();
}
