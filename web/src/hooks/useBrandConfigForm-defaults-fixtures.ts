import {
  act, renderHook
} from '@testing-library/react';
import type {
  BrandConfig, IndustryPresets
} from '../types';
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

interface BrandConfigFormResult { current: ReturnType<typeof useBrandConfigForm> }

export function changePrompt(result: BrandConfigFormResult, prompt: string): void {
  act(() => {
    result.current.handlePromptChange(prompt);
  });
}

export function selectIndustry(result: BrandConfigFormResult, industry: string): void {
  act(() => {
    result.current.setIndustry(industry);
  });
}

export function resetPrompt(result: BrandConfigFormResult): void {
  act(() => {
    result.current.resetPromptToDefault();
  });
}

export function renderBrandConfigForm(
  config: BrandConfig | null = null,
  presets: IndustryPresets | null = null
) {
  return renderHook(() => useBrandConfigForm(config, presets));
}

/** The form over a stored Hotels config with the Hotels preset. */
export function renderHotelBrandConfigForm() {
  return renderBrandConfigForm(buildBrandConfig({ industry: 'hotels' }), HOTEL_PRESETS);
}

export function renderMultiIndustryBrandConfigForm() {
  return renderBrandConfigForm(MULTI_INDUSTRY_OVERRIDE_CONFIG, HOTEL_GENERAL_AND_CUSTOM_PRESETS);
}

export {
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
};
