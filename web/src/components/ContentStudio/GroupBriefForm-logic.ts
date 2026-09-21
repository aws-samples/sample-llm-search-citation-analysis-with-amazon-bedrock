import type {
  ContentBriefBatchRequest,
  ContentBriefFields,
  ContentBriefScope,
  ContentBriefStrategy,
  GroupBriefIdea,
  GroupBriefMode,
  Keyword,
  KeywordGroup,
} from '../../types';

export type PendingGeneration =
  | {
    strategy: 'combined';
    idea: GroupBriefIdea;
    selectedKeywordCount: number;
  }
  | {
    strategy: 'per_keyword';
    request: ContentBriefBatchRequest;
    selectedKeywordCount: number;
  };

export function selectedActiveKeywords(
  scope: ContentBriefScope,
  keywords: Keyword[]
): Keyword[] {
  if (scope.mode === 'groups') {
    const selectedGroups = new Set(scope.group_ids);
    return keywords.filter((keyword) => (
      keyword.group_ids?.some((groupId) => selectedGroups.has(groupId)) === true
    ));
  }
  const selectedIds = new Set(scope.keyword_ids);
  return keywords.filter((keyword) => selectedIds.has(keyword.id));
}

export function canonicalContentBriefScope(
  scope: ContentBriefScope,
  groups: KeywordGroup[],
  selectedKeywords: Keyword[]
): ContentBriefScope {
  if (scope.mode === 'groups') {
    const knownGroups = new Set(groups.map((group) => group.id));
    return {
      mode: 'groups',
      group_ids: scope.group_ids.filter((groupId) => knownGroups.has(groupId)),
    };
  }
  return {
    mode: 'keywords',
    keyword_ids: selectedKeywords.map((keyword) => keyword.id),
  };
}

export function contentBriefFields(
  mode: GroupBriefMode,
  landingUrl: string,
  currentCopy: string,
  templateId: string,
  promptTemplate: string,
  outputLanguage: string
): ContentBriefFields {
  return {
    content_angle: mode,
    landing_url: mode === 'improve_current_url' ? landingUrl.trim() : '',
    current_copy: mode === 'rewrite_pasted_copy' ? currentCopy : '',
    template_id: templateId,
    prompt_template: promptTemplate,
    output_language: outputLanguage,
  };
}

export function pendingContentBriefGeneration(
  strategy: ContentBriefStrategy,
  clientId: string,
  scope: ContentBriefScope,
  fields: ContentBriefFields,
  selectedKeywordCount: number
): PendingGeneration {
  if (strategy === 'combined') {
    return {
      strategy,
      idea: {
        id: clientId,
        type: 'group_brief',
        scope,
        ...fields,
      },
      selectedKeywordCount,
    };
  }
  return {
    strategy,
    request: {
      batch_id: clientId,
      scope,
      brief: fields,
    },
    selectedKeywordCount,
  };
}
