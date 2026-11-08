import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Polyfill `window.matchMedia` for jsdom. Components that consume the
 * `useTheme` hook (chart components, layout, theme toggle) break in
 * tests without it because jsdom does not implement matchMedia.
 *
 * Returns a non-matching media query by default. Tests that need to
 * assert dark-mode behaviour can override `window.matchMedia` per
 * test.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
