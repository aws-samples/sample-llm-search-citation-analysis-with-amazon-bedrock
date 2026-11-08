/**
 * Settings as the Local SEO and Performance pages read them, for specs that `vi.mock('<rel>/hooks/useSeoSettings')`,
 * and the suggestions a field's datalist offers.
 */
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import {
  NO_BRAND_SETTINGS, type BrandSettings
} from '../../../api/brandSettings';
import {
  useBrandSettings, useMarketKeywords
} from '../../../hooks/useSeoSettings';

/** `useBrandSettings` answering `brand` and `useMarketKeywords` answering `keywords` (both loaded, no error). */
export function mockSettingsReads(brand: Partial<BrandSettings>, keywords: readonly string[] = []): void {
  vi.mocked(useBrandSettings).mockReturnValue({
    data: {
      ...NO_BRAND_SETTINGS,
      ...brand,
    },
    loaded: true,
    error: null,
  });
  vi.mocked(useMarketKeywords).mockReturnValue({
    data: [...keywords],
    loaded: true,
    error: null,
  });
}

/** The values the datalist of the field labelled `label` offers, in order. */
export function suggestionsOf(label: string): string[] {
  const listId = screen.getByLabelText(label).getAttribute('list') ?? '';
  const list = document.getElementById(listId);
  return [...(list?.querySelectorAll('option') ?? [])].map((option) => option.value);
}

/** The SettingsHint link to `section` (e.g. "Brand Tracking", "Markets"). */
export function getSettingsLinkElement(section: string): HTMLElement {
  return screen.getByRole('link', { name: `Open Settings › ${section}` });
}
