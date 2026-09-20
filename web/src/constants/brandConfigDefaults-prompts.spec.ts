import {
  describe, expect, it
} from 'vitest';
import { loadBrandConfigDefaults } from './brandConfigDefaults-fixtures';

describe('brand default prompt generation', () => {
  it('lists every configured entity type for a nonempty industry catalogue', async () => {
    const { DEFAULT_PRESETS } = await loadBrandConfigDefaults();

    expect(DEFAULT_PRESETS.hotels.default_prompt).toContain(
      'ENTITY TYPES TO EXTRACT:\n- hotel chains\n- hotel brands\n- individual properties\n- resorts\n- boutique hotels'
    );
  });
});
