import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('displays title and formatted value', () => {
    render(<StatCard title="Total Searches" value={1234} icon="🔍" />);
    
    expect(screen.getByText('Total Searches')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('formats large numbers with locale separators', () => {
    render(<StatCard title="Citations" value={1000000} icon="📎" />);
    
    expect(screen.getByText('1,000,000')).toBeInTheDocument();
  });

  it('displays zero value correctly', () => {
    render(<StatCard title="Empty" value={0} icon="🔑" />);
    
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders SVG icon when icon matches iconMap', () => {
    const { container } = render(<StatCard title="Test" value={5} icon="🔍" />);
    
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders emoji fallback when icon not in iconMap', () => {
    render(<StatCard title="Test" value={5} icon="🎉" />);
    
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });
});
