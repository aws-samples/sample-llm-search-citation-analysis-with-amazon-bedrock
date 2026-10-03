import {
  describe, expect, it
} from 'vitest';
import {
  PRESETS_WITHOUT_CUSTOM,
  renderLoadedBrandConfig,
  runOnLoadedBrandConfig,
} from './useBrandConfig-fixtures';
import {
  EMPTY_INDUSTRY_CONFIG,
  OMITTED_INDUSTRY_CONFIG,
} from './useBrandConfig-defaults-fixtures';
import { GENERAL_FALLBACK_EXPANSIONS } from './useBrandConfig-expansion-fixtures';

describe('useBrandConfig General defaults', () => {
  it('uses General when fetched config omits industry', async () => {
    const configResponse = OMITTED_INDUSTRY_CONFIG;
    const { result } = await renderLoadedBrandConfig({ configResponse });

    expect(result.current.config?.industry).toBe('general');
  });

  it.each(GENERAL_FALLBACK_EXPANSIONS)(
    'sends General to $action when stored industry is empty',
    async ({
      action, run, request
    }) => {
      const { api } = await runOnLoadedBrandConfig(run, { configResponse: EMPTY_INDUSTRY_CONFIG });

      expect(api[action]).toHaveBeenCalledWith(request);
    }
  );

  it('returns an empty prompt when unknown industry has no Custom preset', async () => {
    const presetsResponse = PRESETS_WITHOUT_CUSTOM;
    const { result } = await renderLoadedBrandConfig({ presetsResponse });

    expect(result.current.getPromptForIndustry('legacy-industry')).toBe('');
  });
});
