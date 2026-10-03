import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  createMatchMediaMock, renderTheme, renderThemeSetTo, renderThemeToggledOnce
} from './useTheme-fixtures';
import { createStorageMock } from '../test/storageMock';
import { installStorageMock } from '../test/installStorageMock';

describe('useTheme', () => {
  const localStorageMock = createStorageMock();

  const matchMediaMock = vi.fn().mockImplementation(createMatchMediaMock(false));

  beforeEach(() => {
    installStorageMock(localStorageMock);
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true 
    });
    document.documentElement.classList.remove('dark');
  });

  describe('theme from the stored preference', () => {
    it.each([
      {
        name: 'returns system theme by default when no stored preference',
        stored: {},
        render: renderTheme,
        expected: 'system',
      },
      {
        name: 'returns stored theme from localStorage',
        stored: { theme: 'dark' },
        render: renderTheme,
        expected: 'dark',
      },
      {
        name: 'returns light theme when stored',
        stored: { theme: 'light' },
        render: renderTheme,
        expected: 'light',
      },
      {
        name: 'ignores invalid stored theme values',
        stored: { theme: 'invalid' },
        render: renderTheme,
        expected: 'system',
      },
      {
        name: 'toggleTheme cycles from light to dark',
        stored: { theme: 'light' },
        render: renderThemeToggledOnce,
        expected: 'dark',
      },
      {
        name: 'toggleTheme cycles from dark to system',
        stored: { theme: 'dark' },
        render: renderThemeToggledOnce,
        expected: 'system',
      },
      {
        name: 'toggleTheme cycles from system to light',
        stored: {},
        render: renderThemeToggledOnce,
        expected: 'light',
      },
    ])('$name', ({
      stored, render, expected
    }) => {
      Object.assign(localStorageMock.store, stored);

      const { result } = render();

      expect(result.current.theme).toBe(expected);
    });
  });

  describe('selecting a theme', () => {
    it.each(['dark', 'light'] as const)('updates theme to %s', (theme) => {
      const { result } = renderThemeSetTo(theme);

      expect(result.current.theme).toBe(theme);
    });

    it('saves theme to localStorage', () => {
      renderThemeSetTo('dark');

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('adds dark class to document when theme is dark', () => {
      renderThemeSetTo('dark');

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes dark class from document when theme is light', () => {
      document.documentElement.classList.add('dark');

      renderThemeSetTo('light');

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('isDark', () => {
    it.each([
      {
        name: 'returns true when theme is dark',
        theme: 'dark',
        expected: true,
      },
      {
        name: 'returns false when theme is light',
        theme: 'light',
        expected: false,
      },
    ])('$name', ({
      theme, expected 
    }) => {
      localStorageMock.store['theme'] = theme;

      const { result } = renderTheme();

      expect(result.current.isDark).toBe(expected);
    });

    it('returns system preference when theme is system', () => {
      matchMediaMock.mockImplementation(createMatchMediaMock(true));

      const { result } = renderTheme();

      // System prefers dark
      expect(result.current.isDark).toBe(true);
    });
  });

  describe('system theme listener', () => {
    it('adds event listener for system theme changes', () => {
      const addEventListenerMock = vi.fn();
      matchMediaMock.mockImplementation(createMatchMediaMock(false, { addEventListener: addEventListenerMock }));

      renderTheme();

      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes event listener on unmount', () => {
      const removeEventListenerMock = vi.fn();
      matchMediaMock.mockImplementation(createMatchMediaMock(false, { removeEventListener: removeEventListenerMock }));

      const { unmount } = renderTheme();

      unmount();

      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });
});
