import {
  describe, expect, it
} from 'vitest';
import { act } from '@testing-library/react';
import {
  PRESETS_WITHOUT_CUSTOM,
  renderLoadedBrandConfig,
} from './useBrandConfig-fixtures';
import {
  EMPTY_INDUSTRY_CONFIG,
  OMITTED_INDUSTRY_CONFIG,
} from './useBrandConfig-defaults-fixtures';

describe('useBrandConfig General defaults', () => {
  it('uses General when fetched config omits industry', async () => {
    const configResponse = OMITTED_INDUSTRY_CONFIG;
    const { result } = await renderLoadedBrandConfig({ configResponse });

    expect(result.current.config?.industry).toBe('general');
  });

  it('sends General to expandBrand when stored industry is empty', async () => {
    const {
      api, result
    } = await renderLoadedBrandConfig({ configResponse: EMPTY_INDUSTRY_CONFIG });

    await act(() => result.current.expandBrand('TestBrand'));

    expect(api.expandBrand).toHaveBeenCalledWith({
      brand_name: 'TestBrand',
      industry: 'general',
      existing_brands: [],
    });
  });

  it('sends General to expandAllBrands when stored industry is empty', async () => {
    const {
      api, result
    } = await renderLoadedBrandConfig({ configResponse: EMPTY_INDUSTRY_CONFIG });

    await act(() => result.current.expandAllBrands(['Brand1']));

    expect(api.expandAllBrands).toHaveBeenCalledWith({
      existing_brands: ['Brand1'],
      industry: 'general',
      brand_type: 'first_party',
    });
  });

  it('sends General to findCompetitors when stored industry is empty', async () => {
    const {
      api, result
    } = await renderLoadedBrandConfig({ configResponse: EMPTY_INDUSTRY_CONFIG });

    await act(() => result.current.findCompetitors(['MyBrand']));

    expect(api.findCompetitors).toHaveBeenCalledWith({
      first_party_brands: ['MyBrand'],
      industry: 'general',
      existing_competitors: [],
    });
  });

  it('returns an empty prompt when unknown industry has no Custom preset', async () => {
    const presetsResponse = PRESETS_WITHOUT_CUSTOM;
    const { result } = await renderLoadedBrandConfig({ presetsResponse });

    expect(result.current.getPromptForIndustry('legacy-industry')).toBe('');
  });
});
