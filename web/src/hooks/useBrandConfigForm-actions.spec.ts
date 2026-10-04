import {
  describe, expect, it
} from 'vitest';
import {
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
  MULTI_INDUSTRY_OVERRIDE_CONFIG,
  UNKNOWN_INDUSTRY_CONFIG,
  UNKNOWN_INDUSTRY_OVERRIDE_CONFIG,
  changePrompt,
  renderMultiIndustryBrandConfigForm,
  renderBrandConfigForm,
  resetPrompt,
  selectIndustry,
} from './useBrandConfigForm-defaults-fixtures';

describe('useBrandConfigForm prompt defaults', () => {
  it('marks a stored unknown-industry override as modified', () => {
    const { result } = renderBrandConfigForm(UNKNOWN_INDUSTRY_OVERRIDE_CONFIG, GENERAL_AND_CUSTOM_PRESETS);

    expect(result.current.form.promptModified).toBe(true);
  });

  it('keeps an empty prompt unmodified when no fallback preset exists', () => {
    const { result } = renderBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, HOTEL_PRESETS);

    changePrompt(result, '');

    expect(result.current.form.promptModified).toBe(false);
  });

  it('uses the next industry default when industry selection changes', () => {
    const { result } = renderMultiIndustryBrandConfigForm();

    selectIndustry(result, 'general');

    expect(result.current.form.currentPrompt).toBe('Stored general prompt');
  });

  it('compares edits with the newly selected industry default', () => {
    const config = {
      ...MULTI_INDUSTRY_OVERRIDE_CONFIG,
      industry_prompts: {},
    };
    const { result } = renderBrandConfigForm(config, HOTEL_GENERAL_AND_CUSTOM_PRESETS);
    selectIndustry(result, 'general');

    changePrompt(result, 'Extract general brand and company mentions.');

    expect(result.current.form.promptModified).toBe(false);
  });

  it('removes the newly selected industry override when reset', () => {
    const { result } = renderMultiIndustryBrandConfigForm();
    selectIndustry(result, 'general');

    resetPrompt(result);

    expect(result.current.buildConfig().industry_prompts).toStrictEqual({ hotels: 'Stored hotel prompt' });
  });

  it('omits an empty override when unknown industry has no fallback preset', () => {
    const { result } = renderBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, HOTEL_PRESETS);

    expect(result.current.buildConfig().industry_prompts).toStrictEqual({});
  });
});
