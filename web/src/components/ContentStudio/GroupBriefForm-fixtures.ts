import {
  createElement, type ComponentProps
} from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  Keyword, KeywordGroup
} from '../../types';
import { GroupBriefForm } from './GroupBriefForm';

export function buildKeyword(
  overrides: Partial<Keyword> = {}
): Keyword {
  return {
    id: 'keyword-1',
    keyword: 'Alpha keyword',
    created_at: '2026-01-01T00:00:00Z',
    status: 'active',
    group_ids: ['group-1'],
    ...overrides,
  };
}

export function buildKeywordGroup(
  overrides: Partial<KeywordGroup> = {}
): KeywordGroup {
  return {
    id: 'group-1',
    name: 'Generic Group',
    description: 'A cross-industry keyword group',
    keyword_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function buildKeywordGroupHookResult(
  overrides: Partial<ReturnType<typeof useKeywordGroups>> = {}
): ReturnType<typeof useKeywordGroups> {
  return {
    groups: [buildKeywordGroup()],
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    removeGroup: vi.fn(),
    changeMemberships: vi.fn(),
    ...overrides,
  };
}

export function buildGroupBriefKeywords(): Keyword[] {
  return [
    buildKeyword(),
    buildKeyword({
      id: 'keyword-2',
      keyword: 'Beta keyword',
    }),
    buildKeyword({
      id: 'keyword-inactive',
      keyword: 'Inactive keyword',
      status: 'inactive',
    }),
    buildKeyword({
      id: 'keyword-other',
      keyword: 'Other group keyword',
      group_ids: ['group-2'],
    }),
  ];
}


export function buildGroupBriefFormProps(
  overrides: Partial<ComponentProps<typeof GroupBriefForm>> = {}
): ComponentProps<typeof GroupBriefForm> {
  return {
    keywords: buildGroupBriefKeywords(),
    generating: false,
    onGenerate: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}


export function renderGroupBriefForm(
  overrides: Partial<ComponentProps<typeof GroupBriefForm>> = {}
): ComponentProps<typeof GroupBriefForm> {
  const props = buildGroupBriefFormProps(overrides);
  render(createElement(GroupBriefForm, props));
  return props;
}


export async function selectGroupForBrief(): Promise<void> {
  await userEvent.selectOptions(screen.getByLabelText('Keyword group'), 'group-1');
}

export async function submitGroupBrief(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Generate group brief' }));
}
