import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';

export function buildTabContentKeyword(
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

export function buildTabContentProps(
  overrides: Partial<ComponentProps<typeof TabContent>> = {}
): ComponentProps<typeof TabContent> {
  return {
    activeTab: 'content-studio',
    stats: null,
    citations: null,
    searches: [],
    keywords: [buildTabContentKeyword()],
    setKeywords: vi.fn(),
    schedules: [],
    setSchedules: vi.fn(),
    execution: null,
    triggerAnalysis: vi.fn().mockResolvedValue({
      success: true,
      message: 'started',
    }),
    startMonitoring: vi.fn(),
    isRunning: false,
    setActiveTab: vi.fn(),
    onNavigateToRawResponses: vi.fn(),
    ...overrides,
  };
}
