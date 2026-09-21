import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import {
  buildKeywordScopePickerProps,
  type ScopedPickerOverrides,
} from './KeywordScopePicker-fixtures';

export const cappedSectionAlphaGroup = buildGroup({
  id: 'alpha-group',
  name: 'Alpha group',
  keyword_count: 2,
});
export const cappedSectionBetaGroup = buildGroup({
  id: 'beta-group',
  name: 'Beta group',
  keyword_count: 2,
});
export const cappedSectionGroups = [cappedSectionAlphaGroup, cappedSectionBetaGroup];
export const cappedSectionKeywords = [
  buildKeyword({
    id: 'alpha-1',
    keyword: 'Alpha first',
    group_ids: ['alpha-group'],
  }),
  buildKeyword({
    id: 'alpha-2',
    keyword: 'Alpha second',
    group_ids: ['alpha-group'],
  }),
  buildKeyword({
    id: 'beta-1',
    keyword: 'Beta first',
    group_ids: ['beta-group'],
  }),
  buildKeyword({
    id: 'beta-2',
    keyword: 'Beta second',
    group_ids: ['beta-group'],
  }),
];

export function buildCappedSectionKeywordScopePickerProps(
  selectedIds: readonly string[],
  overrides: ScopedPickerOverrides = {}
) {
  return buildKeywordScopePickerProps(selectedIds, {
    keywords: cappedSectionKeywords,
    groups: cappedSectionGroups,
    ...overrides,
  });
}
