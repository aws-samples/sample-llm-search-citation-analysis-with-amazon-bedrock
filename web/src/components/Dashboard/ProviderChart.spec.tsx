import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { ProviderChart } from './ProviderChart';

vi.mock('chart.js', () => ({
  Chart: Object.assign(vi.fn().mockImplementation(() => ({ destroy: vi.fn() })), {register: vi.fn(),}),
  registerables: [],
}));

describe('ProviderChart', () => {
  it('displays title', () => {
    render(<ProviderChart data={[]} />);
    expect(screen.getByText('Citations by Provider')).toBeInTheDocument();
  });

  it('shows empty state when data is empty', () => {
    render(<ProviderChart data={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText('Run an analysis to see provider stats')).toBeInTheDocument();
  });

  it('hides empty state when data is provided', () => {
    render(<ProviderChart data={[{
      provider: 'OpenAI',
      citation_count: 10 
    }]} />);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });
});
