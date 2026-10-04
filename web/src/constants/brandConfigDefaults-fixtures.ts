import { vi } from 'vitest';
import type { IndustryPresets } from '../types';

export const HOTEL_AND_CUSTOM_PRESETS = {
  hotels: {
    name: 'Hotels',
    description: 'Hotel brands',
    example_brands: ['Marriott'],
    default_prompt: 'Extract hotel brands.',
  },
  custom: {
    name: 'Custom Industry',
    description: 'Custom brands',
    example_brands: [],
    default_prompt: 'Extract custom brands.',
  },
} satisfies IndustryPresets;

export const HOTEL_ONLY_PRESETS = { hotels: HOTEL_AND_CUSTOM_PRESETS.hotels } satisfies IndustryPresets;

export async function loadBrandConfigDefaults() {
  vi.resetModules();
  return await import('./brandConfigDefaults');
}
