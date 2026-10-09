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
import {
  keywordsInMarkets, scopeMarketIds, withMarketIds
} from '../Markets/marketScope';

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
  const inMarkets = keywordsInMarkets(keywords, scopeMarketIds(scope));
  if (scope.mode === 'groups') {
    const selectedGroups = new Set(scope.group_ids);
    return inMarkets.filter((keyword) => (
      keyword.group_ids?.some((groupId) => selectedGroups.has(groupId)) === true
    ));
  }
  const selectedIds = new Set(scope.keyword_ids);
  return inMarkets.filter((keyword) => selectedIds.has(keyword.id));
}

export function canonicalContentBriefScope(
  scope: ContentBriefScope,
  groups: KeywordGroup[],
  selectedKeywords: Keyword[]
): ContentBriefScope {
  const marketIds = scopeMarketIds(scope);
  if (scope.mode === 'groups') {
    const knownGroups = new Set(groups.map((group) => group.id));
    return withMarketIds({
      mode: 'groups',
      group_ids: scope.group_ids.filter((groupId) => knownGroups.has(groupId)),
    }, marketIds);
  }
  return withMarketIds({
    mode: 'keywords',
    keyword_ids: selectedKeywords.map((keyword) => keyword.id),
  }, marketIds);
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
