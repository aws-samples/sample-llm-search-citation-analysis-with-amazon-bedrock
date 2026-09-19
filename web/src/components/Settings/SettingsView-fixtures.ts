import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ComponentProps } from 'react';
import type {
  BrandConfig, IndustryPresets 
} from '../../types';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import type { useIsAdmin } from '../../hooks/useIsAdmin';
import { existingKeywordFixture } from '../Keywords/KeywordsManager-fixtures';
import type { SettingsView } from './SettingsView';

type SettingsViewProps = ComponentProps<typeof SettingsView>;

export function buildSettingsViewProps(overrides: Partial<SettingsViewProps> = {}): SettingsViewProps {
  return {
    keywords: [existingKeywordFixture],
    setKeywords: vi.fn(),
    ...overrides,
  };
}

/** The slice of `useBrandConfig()` that SettingsView reads. */
interface BrandConfigHookSlice {
  config: Pick<BrandConfig, 'industry' | 'tracked_brands'> | null;
  presets: IndustryPresets;
  loading: boolean;
  saveConfig: Mock;
  expandAllBrands: Mock;
  findCompetitors: Mock;
}

/** Brand tracking not set up yet: the state that lights the attention dot. */
export function buildBrandConfigHookResult(
  overrides: Partial<BrandConfigHookSlice> = {}
): BrandConfigHookSlice {
  return {
    config: null,
    presets: {},
    loading: false,
    saveConfig: vi.fn(),
    expandAllBrands: vi.fn(),
    findCompetitors: vi.fn(),
    ...overrides,
  };
}

export const HOSPITALITY_BRAND_CONFIG: BrandConfigHookSlice['config'] = {
  industry: 'hospitality',
  tracked_brands: {
    first_party: ['MyHotel'],
    competitors: [],
  },
};

/** OpenAI with a stored key: the provider row every admin-control test looks at. */
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

type AdminMembership = ReturnType<typeof useIsAdmin>;

/** Resolved membership; pass `{ isAdmin: false }` for a regular user. */
export function buildAdminMembership(overrides: Partial<AdminMembership> = {}): AdminMembership {
  return {
    isAdmin: true,
    loading: false,
    ...overrides,
  };
}
