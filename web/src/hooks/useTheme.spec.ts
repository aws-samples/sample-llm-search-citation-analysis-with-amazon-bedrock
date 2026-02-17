import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  const localStorageMock: {
    store: Record<string, string>;
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  } = {
    store: {},
    getItem: vi.fn((key: string): string | null => {
      const value = localStorageMock.store[key];
      return value ?? null;
    }),
    setItem: vi.fn((key: string, value: string): void => { 
      localStorageMock.store[key] = value; 
    }),
    clear: vi.fn((): void => { 
      Object.keys(localStorageMock.store).forEach(key => delete localStorageMock.store[key]); 
    }),
  };

  const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? false : true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns system theme by default when no stored preference', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('system');
    });

    it('returns stored theme from localStorage', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');
    });

    it('returns light theme when stored', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
    });

    it('ignores invalid stored theme values', () => {
      localStorageMock.store['theme'] = 'invalid';

      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('system');
    });
  });

  describe('setTheme', () => {
    it('updates theme to dark', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
    });

    it('updates theme to light', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
    });

    it('saves theme to localStorage', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('adds dark class to document when theme is dark', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes dark class from document when theme is light', () => {
      document.documentElement.classList.add('dark');

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('toggleTheme', () => {
    it('cycles from light to dark', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
    });

    it('cycles from dark to system', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('system');
    });

    it('cycles from system to light', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('system');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
    });
  });

  describe('isDark', () => {
    it('returns true when theme is dark', () => {
      localStorageMock.store['theme'] = 'dark';

      const { result } = renderHook(() => useTheme());

      expect(result.current.isDark).toBe(true);
    });

    it('returns false when theme is light', () => {
      localStorageMock.store['theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      expect(result.current.isDark).toBe(false);
    });

    it('returns system preference when theme is system', () => {
      matchMediaMock.mockImplementation((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useTheme());

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

      renderHook(() => useTheme());

      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes event listener on unmount', () => {
      const removeEventListenerMock = vi.fn();
      matchMediaMock.mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerMock,
      }));

      const { unmount } = renderHook(() => useTheme());

      unmount();

      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });
});
