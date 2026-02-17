import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { ThemeToggle } from './ThemeToggle';

vi.mock('../../hooks/useTheme', () => ({useTheme: vi.fn(),}));

import { useTheme } from '../../hooks/useTheme';

const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays light mode label when theme is light', () => {
    mockUseTheme.mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggle />);
    
    expect(screen.getByLabelText('Current: Light mode. Click to change.')).toBeInTheDocument();
  });

  it('displays dark mode label when theme is dark', () => {
    mockUseTheme.mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggle />);
    
    expect(screen.getByLabelText('Current: Dark mode. Click to change.')).toBeInTheDocument();
  });

  it('displays system theme label when theme is system', () => {
    mockUseTheme.mockReturnValue({
      theme: 'system',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggle />);
    
    expect(screen.getByLabelText('Current: System theme. Click to change.')).toBeInTheDocument();
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
