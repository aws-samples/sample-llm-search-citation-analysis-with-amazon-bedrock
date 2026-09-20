import {
  describe, expect, it
} from 'vitest';
import {
  HOTEL_AND_CUSTOM_PRESETS,
  HOTEL_ONLY_PRESETS,
  loadBrandConfigDefaults,
} from './brandConfigDefaults-fixtures';

describe('brand configuration defaults', () => {
  it('uses General as the canonical brand industry', async () => {
    const { DEFAULT_BRAND_INDUSTRY } = await loadBrandConfigDefaults();

    expect(DEFAULT_BRAND_INDUSTRY).toBe('general');
  });

  it('uses General for a fresh brand configuration', async () => {
    const { DEFAULT_CONFIG } = await loadBrandConfigDefaults();

    expect(DEFAULT_CONFIG.industry).toBe('general');
  });

  it('returns the requested preset when its industry exists', async () => {
    const { resolveBrandIndustryPreset } = await loadBrandConfigDefaults();

    expect(resolveBrandIndustryPreset(HOTEL_AND_CUSTOM_PRESETS, 'hotels')).toStrictEqual(
      HOTEL_AND_CUSTOM_PRESETS.hotels
    );
  });

  it('returns Custom when the requested industry does not exist', async () => {
    const { resolveBrandIndustryPreset } = await loadBrandConfigDefaults();

    expect(resolveBrandIndustryPreset(HOTEL_AND_CUSTOM_PRESETS, 'legacy')).toStrictEqual(
      HOTEL_AND_CUSTOM_PRESETS.custom
    );
  });

  it('returns undefined when neither requested nor Custom preset exists', async () => {
    const { resolveBrandIndustryPreset } = await loadBrandConfigDefaults();

    expect(resolveBrandIndustryPreset(HOTEL_ONLY_PRESETS, 'legacy')).toBeUndefined();
  });

  it('returns undefined when presets are null', async () => {
    const { resolveBrandIndustryPreset } = await loadBrandConfigDefaults();

    expect(resolveBrandIndustryPreset(null, 'general')).toBeUndefined();
  });

  it('defines the complete industry-neutral General preset', async () => {
    const { DEFAULT_PRESETS } = await loadBrandConfigDefaults();

    expect(DEFAULT_PRESETS.general).toStrictEqual({
      name: 'General',
      description: 'Track brands and companies in any industry',
      entity_types: [],
      example_brands: [],
      extraction_focus: 'brand and company recommendations',
      default_prompt: DEFAULT_PRESETS.general.default_prompt,
    });
  });

  it('uses generic brand entities when the General entity list is empty', async () => {
    const { DEFAULT_PRESETS } = await loadBrandConfigDefaults();

    expect(DEFAULT_PRESETS.general.default_prompt).toContain(
      'ENTITY TYPES TO EXTRACT:\n- Brand names and company names\n\n{{TRACKED_BRANDS}}'
    );
  });

  it('identifies General context and focus in its extraction prompt', async () => {
    const { DEFAULT_PRESETS } = await loadBrandConfigDefaults();

    expect(DEFAULT_PRESETS.general.default_prompt).toContain(
      'INDUSTRY CONTEXT: General\nFOCUS: brand and company recommendations'
    );
  });
});
