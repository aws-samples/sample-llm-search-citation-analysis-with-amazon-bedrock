import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import { KeywordScopePicker } from './KeywordScopePicker';

export const corunaGroupFixture = buildGroup({
  id: 'coruna',
  name: 'Hotel Coruña'
});

export const marinoGroupFixture = buildGroup({
  id: 'marino',
  name: 'Hotel Gran Marino'
});

export const keywordScopePickerKeywords = [
  buildKeyword({
    id: 'k1',
    keyword: 'coruña spa',
    group_ids: ['coruna']
  }),
  buildKeyword({
    id: 'k2',
    keyword: 'marino beach',
    group_ids: ['marino']
  }),
  buildKeyword({
    id: 'k3',
    keyword: 'galicia hotels',
    group_ids: ['coruna', 'marino']
  }),
  buildKeyword({
    id: 'k4',
    keyword: 'loose keyword'
  }),
];

export function buildKeywordScopePickerProps(
  overrides: Partial<ComponentProps<typeof KeywordScopePicker>> = {}
): ComponentProps<typeof KeywordScopePicker> {
  return {
    idPrefix: 'test-keyword-scope',
    name: 'test-keyword-ids',
    keywords: keywordScopePickerKeywords,
    groups: [corunaGroupFixture, marinoGroupFixture],
    selectedIds: [],
    onChange: vi.fn(),
    ...overrides,
  };
}

export function renderKeywordScopePicker(
  overrides: Partial<ComponentProps<typeof KeywordScopePicker>> = {}
): ComponentProps<typeof KeywordScopePicker> {
  const pickerProps = buildKeywordScopePickerProps(overrides);
  render(<KeywordScopePicker {...pickerProps} />);
  return pickerProps;
}
