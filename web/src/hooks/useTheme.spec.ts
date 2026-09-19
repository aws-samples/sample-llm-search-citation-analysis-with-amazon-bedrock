import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  renderTheme, renderThemeSetTo, renderThemeToggledOnce 
} from './useTheme-fixtures';
import { createStorageMock } from '../test/storageMock';

describe('useTheme', () => {
  const localStorageMock = createStorageMock();

  const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? false : true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  beforeEach(() => {
    Object.keys(localStorageMock.store).forEach(key => delete localStorageMock.store[key]);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true 
    });
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true 
    });
    document.documentElement.classList.remove('dark');
  });

  describe('initial state', () => {
    it('returns system theme by default when no stored preference', () => {
      const { result } = renderTheme();
      expect(result.current.theme).toBe('system');
    });

    it('returns stored theme from localStorage', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderTheme();
      expect(result.current.theme).toBe('dark');
    });

    it('returns light theme when stored', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderTheme();
      expect(result.current.theme).toBe('light');
    });

    it('ignores invalid stored theme values', () => {
      localStorageMock.store['theme'] = 'invalid';

      const { result } = renderTheme();
      expect(result.current.theme).toBe('system');
    });
  });

  describe('setTheme', () => {
    it('updates theme to dark', () => {
      const { result } = renderThemeSetTo('dark');

      expect(result.current.theme).toBe('dark');
    });

    it('updates theme to light', () => {
      const { result } = renderThemeSetTo('light');

      expect(result.current.theme).toBe('light');
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

  describe('toggleTheme', () => {
    it('cycles from light to dark', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderThemeToggledOnce();

      expect(result.current.theme).toBe('dark');
    });

    it('cycles from dark to system', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderThemeToggledOnce();

      expect(result.current.theme).toBe('system');
    });

    it('cycles from system to light', () => {
      const { result } = renderThemeToggledOnce();

      expect(result.current.theme).toBe('light');
    });
  });

  describe('isDark', () => {
    it('returns true when theme is dark', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderTheme();

      expect(result.current.isDark).toBe(true);
    });

    it('returns false when theme is light', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderTheme();

      expect(result.current.isDark).toBe(false);
    });

    it('returns system preference when theme is system', () => {
      matchMediaMock.mockImplementation((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderTheme();

      // System prefers dark
      expect(result.current.isDark).toBe(true);
    });
  });

  describe('system theme listener', () => {
    it('adds event listener for system theme changes', () => {
      const addEventListenerMock = vi.fn();
      matchMediaMock.mockImplementation(() => ({
        matches: false,
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
      }));

      renderTheme();

      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes event listener on unmount', () => {
      const removeEventListenerMock = vi.fn();
      matchMediaMock.mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerMock,
      }));

      const { unmount } = renderTheme();

      unmount();

      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });
});
