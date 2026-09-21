import { vi } from 'vitest';
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

export function prepareGroupBriefClientIdMocks(): void {
  vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupHookResult());
  vi.mocked(useContentBriefTemplates).mockReturnValue(
    buildContentBriefTemplatesHookResult()
  );
}

export async function submitGroupBriefTwice(
  onGenerate: (idea: GroupBriefIdea) => Promise<boolean>
): Promise<void> {
  renderGroupBriefForm({ onGenerate });
  await selectGroupForBrief();
  await submitGroupBrief();
  await submitGroupBrief();
}
