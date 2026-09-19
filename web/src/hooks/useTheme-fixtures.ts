import {
  renderHook, act 
} from '@testing-library/react';
import { useTheme } from './useTheme';

type Theme = ReturnType<typeof useTheme>['theme'];

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
