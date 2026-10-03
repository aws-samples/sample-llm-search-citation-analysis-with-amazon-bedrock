import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { ThemeToggle } from './ThemeToggle';

vi.mock('../../hooks/useTheme', () => ({useTheme: vi.fn(),}));

import { useTheme } from '../../hooks/useTheme';

const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;

describe('ThemeToggle', () => {
  it.each([
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
    mockUseTheme.mockReturnValue({
      theme: themeName,
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggle />);
    
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('calls toggleTheme when button clicked', () => {
    const toggleTheme = vi.fn();
    mockUseTheme.mockReturnValue({
      theme: 'light',
      toggleTheme,
    });
    
    render(<ThemeToggle />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
