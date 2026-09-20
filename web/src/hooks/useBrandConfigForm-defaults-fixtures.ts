import { renderHook } from '@testing-library/react';
import type { IndustryPresets } from '../types';
import { useBrandConfigForm } from './useBrandConfigForm';
import {
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
  buildBrandConfig,
} from './useBrandConfigFormFixtures';

export const EMPTY_INDUSTRY_BRAND_CONFIG = buildBrandConfig({ industry: '' });

export const UNKNOWN_INDUSTRY_CONFIG = buildBrandConfig({ industry: 'legacy-industry' });

export const UNKNOWN_INDUSTRY_OVERRIDE_CONFIG = buildBrandConfig({
  industry: 'legacy-industry',
  industry_prompts: {
    'legacy-industry': 'Stored legacy prompt',
    general: 'Retained general prompt',
  },
});

export const HOTEL_GENERAL_AND_CUSTOM_PRESETS = {
  ...HOTEL_PRESETS,
  ...GENERAL_AND_CUSTOM_PRESETS,
} satisfies IndustryPresets;

export const MULTI_INDUSTRY_OVERRIDE_CONFIG = buildBrandConfig({
  industry: 'hotels',
  industry_prompts: {
    hotels: 'Stored hotel prompt',
    general: 'Stored general prompt',
  },
});

export function renderMultiIndustryBrandConfigForm() {
  return renderHook(
    () => useBrandConfigForm(MULTI_INDUSTRY_OVERRIDE_CONFIG, HOTEL_GENERAL_AND_CUSTOM_PRESETS)
  );
}

export {
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
};
