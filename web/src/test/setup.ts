import '@testing-library/jest-dom/vitest';
import {
  afterEach, vi
} from 'vitest';
import { resetLiveEvents } from './liveEventsMock';

/**
 * Every spec gets the fake live events of `liveEventsMock.ts` in place of the AppSync Events client, so no spec
 * opens a WebSocket, and the fake forgets its listeners after each test. The client's own specs import
 * `liveEventsClient.ts` and `liveWait.ts` directly, which this does not replace.
 */
vi.mock('../infrastructure/liveEvents', () => import('./liveEventsMock'));
afterEach(() => {
  resetLiveEvents();
});

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
