import {
  describe, it, expect 
} from 'vitest';
import {
  buildBrandConfig, buildBrandConfigWithBrands 
} from '../../hooks/useBrandConfigFormFixtures';
import { INDUSTRY_PRESETS } from './IndustrySelector-fixtures';
import {
  countTrackedBrands, describeIndustry 
} from './brandConfigSummary';

describe('describeIndustry', () => {
  it('returns the preset display name when the presets know the industry', () => {
    expect(describeIndustry(buildBrandConfig({ industry: 'hospitality' }), INDUSTRY_PRESETS)).toBe('Hospitality');
  });

  it('falls back to the raw industry key when the presets do not know it', () => {
    expect(describeIndustry(buildBrandConfig({ industry: 'aviation' }), INDUSTRY_PRESETS)).toBe('aviation');
  });

  it('returns the raw industry key when no presets have loaded', () => {
    expect(describeIndustry(buildBrandConfig({ industry: 'hotels' }), null)).toBe('hotels');
  });

  it('says not configured when there is no config', () => {
    expect(describeIndustry(null, INDUSTRY_PRESETS)).toBe('Not configured');
  });

  it('says not configured when the config has an empty industry', () => {
    expect(describeIndustry(buildBrandConfig({ industry: '' }), INDUSTRY_PRESETS)).toBe('Not configured');
  });
});

describe('countTrackedBrands', () => {
  it('counts the first-party brands of a config', () => {
    expect(countTrackedBrands(buildBrandConfigWithBrands(['Marriott', 'Ritz'], ['Hilton']), 'first_party')).toBe(2);
  });

  it('counts the competitor brands of a config', () => {
    expect(countTrackedBrands(buildBrandConfigWithBrands(['Marriott', 'Ritz'], ['Hilton']), 'competitors')).toBe(1);
  });

  it('returns zero without a config', () => {
    expect(countTrackedBrands(null, 'first_party')).toBe(0);
  });
});
