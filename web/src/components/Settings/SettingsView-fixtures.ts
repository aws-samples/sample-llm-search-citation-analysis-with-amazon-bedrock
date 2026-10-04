import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { BrandConfig } from '../../types';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import type { useIsAdmin } from '../../hooks/useIsAdmin';
import { DEFAULT_CONFIG } from '../../constants/brandConfigDefaults';
import { existingKeywordFixture } from '../Keywords/KeywordsManager-fixtures';
import type { SettingsView } from './SettingsView';

type SettingsViewProps = ComponentProps<typeof SettingsView>;
type AdminMembership = ReturnType<typeof useIsAdmin>;

export function buildSettingsViewProps(overrides: Partial<SettingsViewProps> = {}): SettingsViewProps {
  return {
    keywords: [existingKeywordFixture],
    setKeywords: vi.fn(),
    ...overrides,
  };
}

export const HOSPITALITY_BRAND_CONFIG: BrandConfig = {
  ...DEFAULT_CONFIG,
  industry: 'hospitality',
  tracked_brands: {
    first_party: ['MyHotel'],
    competitors: [],
  },
};

export function buildConfiguredOpenAiProvider(): ProviderConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4 model',
    model: 'gpt-4',
    docs_url: 'https://openai.com',
    enabled: true,
    configured: true,
    masked_key: '****1234',
    last_updated: null,
  };
}

export function buildAdminMembership(overrides: Partial<AdminMembership> = {}): AdminMembership {
  return {
    isAdmin: true,
    loading: false,
    ...overrides,
  };
}
