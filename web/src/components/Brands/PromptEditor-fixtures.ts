import { vi } from 'vitest';
import type { IndustryPresets } from '../../types';

const DEFAULTS = {
  industry: 'hospitality',
  presets: {
    hospitality: {
      name: 'Hospitality',
      description: 'Hotels and travel',
      entity_types: ['hotel'],
      example_brands: ['Marriott'],
      extraction_focus: 'hotels',
      default_prompt: 'Default prompt',
    },
    retail: {
      name: 'Retail',
      description: 'Retail stores',
      entity_types: ['store'],
      example_brands: ['Amazon'],
      extraction_focus: 'stores',
      default_prompt: 'Default prompt',
    },
  } satisfies IndustryPresets,
  industryPrompts: { hospitality: 'Custom hospitality prompt' },
  currentPrompt: 'Test prompt',
  promptModified: false,
  onIndustryChange: vi.fn(),
  onPromptChange: vi.fn(),
  onResetToDefault: vi.fn(),
};

export function buildProps(overrides = {}) {
  return {
    ...DEFAULTS,
    onIndustryChange: vi.fn(),
    onPromptChange: vi.fn(),
    onResetToDefault: vi.fn(),
    ...overrides,
  };
}
