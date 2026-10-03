import {
  renderHook, act 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { useBrandConfigForm } from './useBrandConfigForm';
import {
  buildBrandConfig,
  buildBrandConfigWithBrands,
} from './useBrandConfigFormFixtures';
import {
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
  UNKNOWN_INDUSTRY_CONFIG,
  changePrompt,
  renderBrandConfigForm,
  renderHotelBrandConfigForm,
  resetPrompt,
} from './useBrandConfigForm-defaults-fixtures';

describe('useBrandConfigForm', () => {
  describe('initialization', () => {
    it('returns "general" when config is null', () => {
      const { result } = renderBrandConfigForm();

      expect(result.current.form.industry).toBe('general');
    });

    it('preserves "hotels" when stored config selects Hotels', () => {
      const config = buildBrandConfig({ industry: 'hotels' });

      const { result } = renderBrandConfigForm(config, HOTEL_PRESETS);

      expect(result.current.form.industry).toBe('hotels');
    });

    it('uses Custom preset without rewriting an unknown stored industry', () => {
      const config = UNKNOWN_INDUSTRY_CONFIG;

      const { result } = renderBrandConfigForm(config, GENERAL_AND_CUSTOM_PRESETS);

      expect(result.current.form.industry).toBe('legacy-industry');
      expect(result.current.currentPreset).toStrictEqual(GENERAL_AND_CUSTOM_PRESETS.custom);
      expect(result.current.form.currentPrompt).toBe('Extract custom brand and company mentions.');
    });

    it('returns empty arrays for brands when config is null', () => {
      const { result } = renderBrandConfigForm();

      expect(result.current.form.firstPartyBrands).toStrictEqual([]);
      expect(result.current.form.competitorBrands).toStrictEqual([]);
    });

    it('returns config industry when config provided', () => {
      const config = buildBrandConfig({ industry: 'restaurants' });

      const { result } = renderBrandConfigForm(config, null);

      expect(result.current.form.industry).toBe('restaurants');
    });

    it('returns config brands when config provided', () => {
      const config = buildBrandConfigWithBrands(['Brand A', 'Brand B'], ['Competitor X']);

      const { result } = renderBrandConfigForm(config, null);

      expect(result.current.form.firstPartyBrands).toStrictEqual(['Brand A', 'Brand B']);
      expect(result.current.form.competitorBrands).toStrictEqual(['Competitor X']);
    });
  });

  describe('brandExists', () => {
    it.each([
      [true, 'brand exists with exact match', 'Marriott', ['Marriott', 'Hilton']],
      [true, 'brand exists with different case', 'marriott', ['Marriott', 'Hilton']],
      [true, 'brand exists with diacritics difference', 'Cafe', ['Café', 'Bistro']],
      [true, 'brand exists with surrounding whitespace and mixed case', '  MARRIOTT  ', ['marriott']],
      [true, 'a whitespace-only name matches an empty name', '   ', ['']],
      [true, 'only the new name carries the accent', 'Café', ['cafe']],
      [false, 'brand does not exist in list', 'Hyatt', ['Marriott', 'Hilton']],
      [false, 'list is empty', 'Marriott', []],
    ])('returns %s when %s', (expected, _condition, brand, brands) => {
      const { result } = renderBrandConfigForm();

      expect(result.current.brandExists(brand, brands)).toBe(expected);
    });
  });

  describe('setFirstPartyBrands', () => {
    it('updates firstPartyBrands when called with new array', () => {
      const { result } = renderBrandConfigForm();

      act(() => {
        result.current.setFirstPartyBrands(['New Brand']);
      });

      expect(result.current.form.firstPartyBrands).toStrictEqual(['New Brand']);
    });
  });

  describe('buildConfig', () => {
    it('returns config with current form values', () => {
      const { result } = renderBrandConfigForm();

      act(() => {
        result.current.setIndustry('restaurants');
        result.current.setFirstPartyBrands(['My Restaurant']);
        result.current.setMaxBrands(10);
      });

      const config = result.current.buildConfig();

      expect(config.industry).toBe('restaurants');
      expect(config.tracked_brands.first_party).toStrictEqual(['My Restaurant']);
      expect(config.max_brands).toBe(10);
    });

    it('includes custom prompt in industry_prompts when prompt modified', () => {
      const { result } = renderHotelBrandConfigForm();

      changePrompt(result, 'Custom prompt text');

      const config = result.current.buildConfig();

      expect(config.industry_prompts).toStrictEqual({ hotels: 'Custom prompt text' });
    });

    it('excludes prompt from industry_prompts when prompt matches default', () => {
      const { result } = renderHotelBrandConfigForm();

      const config = result.current.buildConfig();

      expect(config.industry_prompts).toStrictEqual({});
    });
    it('omits an override when unknown industry uses the Custom default', () => {
      const config = UNKNOWN_INDUSTRY_CONFIG;
      const { result } = renderBrandConfigForm(config, GENERAL_AND_CUSTOM_PRESETS);

      const builtConfig = result.current.buildConfig();

      expect(builtConfig.industry_prompts).toStrictEqual({});
    });
  });

  describe('handlePromptChange', () => {
    it.each([
      [true, 'prompt differs from default', 'Modified prompt'],
      [false, 'prompt matches default', 'Extract hotel brands from text.'],
    ])('sets promptModified to %s when %s', (expected, _condition, prompt) => {
      const { result } = renderHotelBrandConfigForm();

      changePrompt(result, prompt);

      expect(result.current.form.promptModified).toBe(expected);
    });

    it('keeps Custom default unmodified when configured industry is unknown', () => {
      const config = UNKNOWN_INDUSTRY_CONFIG;
      const { result } = renderBrandConfigForm(config, GENERAL_AND_CUSTOM_PRESETS);

      changePrompt(result, 'Extract custom brand and company mentions.');

      expect(result.current.form.promptModified).toBe(false);
    });
  });

  describe('resetPromptToDefault', () => {
    it('restores default prompt when called after modification', () => {
      const { result } = renderHotelBrandConfigForm();

      changePrompt(result, 'Custom prompt');
      resetPrompt(result);

      expect(result.current.form.currentPrompt).toBe('Extract hotel brands from text.');
      expect(result.current.form.promptModified).toBe(false);
    });
    it('restores Custom default when configured industry is unknown', () => {
      const config = buildBrandConfig({
        industry: 'legacy-industry',
        industry_prompts: { 'legacy-industry': 'Stored legacy prompt' },
      });
      const { result } = renderBrandConfigForm(config, GENERAL_AND_CUSTOM_PRESETS);

      resetPrompt(result);

      expect(result.current.form.currentPrompt).toBe('Extract custom brand and company mentions.');
      expect(result.current.form.promptModified).toBe(false);
    });
  });

  describe('config sync', () => {
    it('updates form state when config prop changes', () => {
      const initialConfig = buildBrandConfig({ industry: 'hotels' });
      const {
        result, rerender 
      } = renderHook(
        ({ config }) => useBrandConfigForm(config, null),
        { initialProps: { config: initialConfig } }
      );

      expect(result.current.form.industry).toBe('hotels');

      const newConfig = buildBrandConfig({ industry: 'airlines' });
      rerender({ config: newConfig });

      expect(result.current.form.industry).toBe('airlines');
    });
  });
});
