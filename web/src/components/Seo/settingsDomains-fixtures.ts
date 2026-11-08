/**
 * Settings › Brand Tracking as the SEO lookup pages read it, for specs that mock `hooks/useSeoSettings`.
 */
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { BrandSettings } from '../../api/brandSettings';
import { useBrandSettings } from '../../hooks/useSeoSettings';

export const OWN_DOMAIN = 'brand.example';

export function buildBrandSettings(overrides: Partial<BrandSettings> = {}): BrandSettings {
  return {
    brandNames: ['Brand'],
    ownedDomains: [OWN_DOMAIN],
    competitorDomains: [
      {
        name: 'Acme',
        domain: 'acme.example.org',
      },
      {
        name: 'Globex',
        domain: 'globex.example',
      },
    ],
    ...overrides,
  };
}

/** `useBrandSettings` answering `data` (loaded, no error). */
export function mockBrandSettings(data: BrandSettings = buildBrandSettings()): void {
  vi.mocked(useBrandSettings).mockReturnValue({
    data,
    loaded: true,
    error: null,
  });
}

/** Brand Tracking with competitors but no own domain. */
export const NO_OWN_DOMAIN = buildBrandSettings({ ownedDomains: [] });

/** The "Analyze <own domain>" button shown while the input is empty. */
export function getAnalyzeOwnDomainElement(): HTMLElement {
  return screen.getByRole('button', { name: `Analyze ${OWN_DOMAIN}` });
}

/** The SettingsHint link to Settings › Brand Tracking. */
export function findBrandTrackingLinkElement(): Promise<HTMLElement> {
  return screen.findByRole('link', { name: 'Open Settings › Brand Tracking' });
}

/** The quick-pick chips' domains, in the order shown. */
export function quickPickDomains(): Array<string | null> {
  return [...screen.getByLabelText('Your and competitor domains').querySelectorAll('button')].map((button) => button.textContent);
}
