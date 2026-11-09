import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { ThemeToggle } from './ThemeToggle';

vi.mock('../../hooks/useTheme', () => ({useTheme: vi.fn(),}));

import { useTheme } from '../../hooks/useTheme';

const mockUseTheme = vi.mocked(useTheme);

type Theme = ReturnType<typeof useTheme>['theme'];

interface ThemeLabelCase {
  themeName: Theme;
  label: string;
}

/** Mocks the hook on `theme`; `isDark` is unused by the toggle, so it tracks only explicit dark. */
function mockTheme(theme: Theme, toggleTheme = vi.fn()) {
  mockUseTheme.mockReturnValue({
    theme,
    toggleTheme,
    isDark: theme === 'dark',
  });
}

describe('ThemeToggle', () => {
  it.each<ThemeLabelCase>([
    {
      themeName: 'light',
      label: 'Current: Light mode. Click to change.',
    },
    {
      themeName: 'dark',
      label: 'Current: Dark mode. Click to change.',
    },
    {
      themeName: 'system',
      label: 'Current: System theme. Click to change.',
    },
  ])('displays the $themeName label when theme is $themeName', ({
    themeName, label
  }) => {
    mockTheme(themeName);
    
    render(<ThemeToggle />);
    
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it.each<[string, Theme, string]>([
    ['a sun', 'light', 'M12 3v1m0 16v1'],
    ['a moon', 'dark', 'M20.354 15.354'],
    ['a monitor', 'system', 'M9.75 17L9 20'],
  ])('draws %s for the %s theme', (_icon, themeName, pathStart) => {
    mockTheme(themeName);

    const { container } = render(<ThemeToggle />);

    expect(container.querySelector('path')?.getAttribute('d')?.startsWith(pathStart)).toBe(true);
  });

  it('calls toggleTheme when button clicked', () => {
    const toggleTheme = vi.fn();
    mockTheme('light', toggleTheme);
    
    render(<ThemeToggle />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
