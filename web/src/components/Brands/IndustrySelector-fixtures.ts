import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { IndustryPresets } from '../../types';
import type { IndustrySelector } from './IndustrySelector';

type IndustrySelectorProps = ComponentProps<typeof IndustrySelector>;

export const INDUSTRY_PRESETS = {
  hospitality: {
    name: 'Hospitality',
    description: 'Hotels and travel',
    example_brands: ['Marriott', 'Hilton'],
    entity_types: ['hotel'],
    extraction_focus: 'brands',
    default_prompt: 'test',
  },
  retail: {
    name: 'Retail',
    description: 'Retail stores',
    example_brands: ['Amazon', 'Walmart'],
    entity_types: ['store'],
    extraction_focus: 'brands',
    default_prompt: 'test',
  },
} satisfies IndustryPresets;

/** The selector on the hospitality preset with no custom prompts; every prop can be overridden. */
export function buildIndustrySelectorProps(
  overrides: Partial<IndustrySelectorProps> = {}
): IndustrySelectorProps {
  return {
    industry: 'hospitality',
    presets: INDUSTRY_PRESETS,
    industryPrompts: {},
    currentPreset: INDUSTRY_PRESETS.hospitality,
    onIndustryChange: vi.fn(),
    ...overrides,
  };
}
