import { vi } from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useTheme } from './useTheme';

type Theme = ReturnType<typeof useTheme>['theme'];

type MediaQueryListeners = Partial<Pick<MediaQueryList, 'addEventListener' | 'removeEventListener'>>;

/**
 * A `window.matchMedia` implementation for a system that prefers dark when
 * `prefersDark`; listener functions default to fresh spies.
 */
export function createMatchMediaMock(prefersDark: boolean, listeners: MediaQueryListeners = {}) {
  return (query: string) => ({
    matches: query.includes('dark') ? prefersDark : !prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...listeners,
  });
}

export function renderTheme() {
  return renderHook(() => useTheme());
}

/** Mounts the hook and selects `theme` through `setTheme`. */
export function renderThemeSetTo(theme: Theme) {
  const rendered = renderTheme();
  act(() => {
    rendered.result.current.setTheme(theme);
  });
  return rendered;
}

/** Mounts the hook and advances the light → dark → system cycle once. */
export function renderThemeToggledOnce() {
  const rendered = renderTheme();
  act(() => {
    rendered.result.current.toggleTheme();
  });
  return rendered;
}
