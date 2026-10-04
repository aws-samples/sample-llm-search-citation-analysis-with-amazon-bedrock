import {
  describe, expect, it
} from 'vitest';
import {
  EMPTY_INDUSTRY_BRAND_CONFIG,
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
  UNKNOWN_INDUSTRY_CONFIG,
  UNKNOWN_INDUSTRY_OVERRIDE_CONFIG,
  renderBrandConfigForm,
  resetPrompt,
} from './useBrandConfigForm-defaults-fixtures';
import type { useBrandConfigForm } from './useBrandConfigForm';

type BrandConfigFormState = ReturnType<typeof useBrandConfigForm>;

describe('useBrandConfigForm General defaults', () => {
  it.each([
    {
      name: 'uses General when stored industry is empty',
      config: EMPTY_INDUSTRY_BRAND_CONFIG,
      presets: GENERAL_AND_CUSTOM_PRESETS,
      read: (state: BrandConfigFormState) => state.form.industry,
      expected: 'general',
    },
    {
      name: 'preserves an unknown stored industry key',
      config: UNKNOWN_INDUSTRY_CONFIG,
      presets: GENERAL_AND_CUSTOM_PRESETS,
      read: (state: BrandConfigFormState) => state.form.industry,
      expected: 'legacy-industry',
    },
    {
      name: 'returns Custom preset when stored industry is unknown',
      config: UNKNOWN_INDUSTRY_CONFIG,
      presets: GENERAL_AND_CUSTOM_PRESETS,
      read: (state: BrandConfigFormState) => state.currentPreset,
      expected: GENERAL_AND_CUSTOM_PRESETS.custom,
    },
    {
      name: 'uses Custom default prompt when stored industry is unknown',
      config: UNKNOWN_INDUSTRY_CONFIG,
      presets: GENERAL_AND_CUSTOM_PRESETS,
      read: (state: BrandConfigFormState) => state.form.currentPrompt,
      expected: 'Extract custom brand and company mentions.',
    },
    {
      name: 'uses stored override before Custom fallback for unknown industry',
      config: UNKNOWN_INDUSTRY_OVERRIDE_CONFIG,
      presets: GENERAL_AND_CUSTOM_PRESETS,
      read: (state: BrandConfigFormState) => state.form.currentPrompt,
      expected: 'Stored legacy prompt',
    },
    {
      name: 'returns no preset when unknown industry has no Custom fallback',
      config: UNKNOWN_INDUSTRY_CONFIG,
      presets: HOTEL_PRESETS,
      read: (state: BrandConfigFormState) => state.currentPreset,
      expected: undefined,
    },
    {
      name: 'uses an empty prompt when unknown industry has no Custom fallback',
      config: UNKNOWN_INDUSTRY_CONFIG,
      presets: HOTEL_PRESETS,
      read: (state: BrandConfigFormState) => state.form.currentPrompt,
      expected: '',
    },
  ])('$name', ({
    config, presets, read, expected
  }) => {
    const { result } = renderBrandConfigForm(config, presets);

    expect(read(result.current)).toStrictEqual(expected);
  });

  it('removes only the unknown-industry override when reset to Custom default', () => {
    const { result } = renderBrandConfigForm(UNKNOWN_INDUSTRY_OVERRIDE_CONFIG, GENERAL_AND_CUSTOM_PRESETS);

    resetPrompt(result);

    const industryPrompts = result.current.buildConfig().industry_prompts;
    expect(industryPrompts).toStrictEqual({ general: 'Retained general prompt' });
  });
});
