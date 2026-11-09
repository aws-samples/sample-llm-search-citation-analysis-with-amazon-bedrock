import {
  useState, useEffect 
} from 'react';

type Theme = 'light' | 'dark' | 'system';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** A report preview tab (`?print=1`, see `usePrintMode`) always renders light: print output is light. */
const isPrintPreview = () => new URLSearchParams(window.location.search).get('print') === '1';

const resolvesDark = (theme: Theme) => !isPrintPreview() && (theme === 'dark' || (theme === 'system' && prefersDark()));

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    }
    return 'system';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvesDark(theme));
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Follow system theme changes, and print light from a dark screen (Ctrl+P / Cmd+P).
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => root.classList.toggle('dark', resolvesDark(theme));
    const printLight = () => root.classList.remove('dark');

    mediaQuery.addEventListener('change', applyTheme);
    window.addEventListener('beforeprint', printLight);
    window.addEventListener('afterprint', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
      window.removeEventListener('beforeprint', printLight);
      window.removeEventListener('afterprint', applyTheme);
    };
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  };

  const isDark = resolvesDark(theme);

  return {
    theme,
    toggleTheme,
    isDark 
  };
};
