import {
  createElement, type ComponentProps
} from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { buildApiTemplate } from '../../api/contentStudio-fixtures';
import type { useContentBriefTemplates } from '../../hooks/useContentBriefTemplates';
import type { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import type {
  ContentBriefScope, Keyword, KeywordGroup
} from '../../types';
import { buildTabContentKeyword } from '../Layout/TabContent-fixtures';
import { GroupBriefForm } from './GroupBriefForm';
import {
  GROUP_BRIEF_DEFAULT_TEMPLATES,
  type GroupBriefDraft,
} from './GroupBriefForm-source';

export const buildKeyword = buildTabContentKeyword;

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
    ...buildKeywordGroupsHookResult([buildKeywordGroup(), buildKeywordGroup({
      id: 'group-2',
      name: 'Other Group',
      keyword_count: 1,
    })]),
    ...overrides,
  };
}

export const buildContentBriefTemplate = buildApiTemplate;

export function buildContentBriefTemplatesHookResult(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {}
): ReturnType<typeof useContentBriefTemplates> {
  return {
    templates: [
      buildContentBriefTemplate({
        id: 'builtin-improve-current-url',
        name: 'Improve current URL',
        content_angle: 'improve_current_url',
        prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.improve_current_url,
      }),
      buildContentBriefTemplate({
        id: 'builtin-rewrite-pasted-copy',
        name: 'Rewrite pasted copy',
        content_angle: 'rewrite_pasted_copy',
        prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy,
      }),
      buildContentBriefTemplate(),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
    create: vi.fn().mockResolvedValue({
      success: true,
      message: 'saved',
    }),
    update: vi.fn().mockResolvedValue({
      success: true,
      message: 'updated',
    }),
    remove: vi.fn().mockResolvedValue({
      success: true,
      message: 'deleted',
    }),
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
    onGenerateBatch: vi.fn().mockResolvedValue(true),
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
  await userEvent.click(screen.getByRole('radio', { name: 'Groups' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Generic Group' }));
}

export async function selectKeywordForBrief(name = 'Alpha keyword'): Promise<void> {
  await userEvent.click(screen.getByRole('checkbox', { name }));
}

export async function fillImproveUrlBrief(landingUrl: string): Promise<void> {
  await selectGroupForBrief();
  await userEvent.click(screen.getByRole('radio', { name: /Improve current URL/u }));
  await userEvent.type(screen.getByLabelText('Current landing URL'), landingUrl);
}

export async function reviewGroupBrief(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Review generation' }));
}

export async function confirmGroupBrief(jobCount = 1): Promise<void> {
  const noun = jobCount === 1 ? 'job' : 'jobs';
  await userEvent.click(screen.getByRole('button', { name: `Start ${jobCount} ${noun}` }));
}

export async function submitGroupBrief(): Promise<void> {
  await reviewGroupBrief();
  await confirmGroupBrief();
}


export async function selectKeywordsForBrief(names: readonly string[]): Promise<void> {
  for (const name of names) await selectKeywordForBrief(name);
}

export async function selectPerKeywordStrategy(): Promise<void> {
  await userEvent.click(screen.getByRole('radio', { name: 'Create a separate brief for each keyword' }));
}


export function buildContentBriefKeywordScope(
  keywordIds: string[]
): ContentBriefScope {
  return {
    mode: 'keywords',
    keyword_ids: keywordIds,
  };
}


export function buildNumberedKeywords(count: number): Keyword[] {
  return Array.from({ length: count }, (_, index) => buildKeyword({
    id: `keyword-${index + 1}`,
    keyword: `Keyword ${index + 1}`,
  }));
}


export function buildGroupBriefDraft(
  overrides: Partial<GroupBriefDraft> = {}
): GroupBriefDraft {
  return {
    scope: buildContentBriefKeywordScope(['keyword-1']),
    selectedKeywordCount: 1,
    strategy: 'combined',
    mode: 'create_new_landing_page',
    landingUrl: '',
    currentCopy: '',
    promptTemplate: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
    templateId: 'builtin-create-new-landing-page',
    ...overrides,
  };
}
