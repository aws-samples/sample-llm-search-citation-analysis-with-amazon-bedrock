import {
  render, screen, fireEvent, act
} from '@testing-library/react';
import {
  describe, it, expect, vi
} from 'vitest';
import { BrandConfigContent } from './BrandConfigContent';
import { mockBrandConfig } from '../../hooks/useBrandConfig-fixtures';

vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => ({ isAdmin: true }) }));

function renderAndAddDomain(input: string) {
  render(
    <BrandConfigContent
      config={{
        ...mockBrandConfig,
        first_party_domains: [] 
      }}
      presets={null}
      loading={false}
      onSave={vi.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText('New first party domain'), { target: { value: input } });
  fireEvent.keyDown(screen.getByLabelText('New first party domain'), { key: 'Enter' });
}

describe('BrandConfigContent owned domains', () => {
  it('adds the canonical domain when the input carries a scheme, www, port and path', () => {
    renderAndAddDomain('https://www.Example.com:443/rooms?view=sea');

    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('adds nothing when the input has no host', () => {
    renderAndAddDomain('https://');

    expect(screen.getByText(/No domains added/)).toBeInTheDocument();
  });
});

describe('BrandConfigContent states', () => {
  it('shows only the loading message while the configuration loads', () => {
    render(<BrandConfigContent config={mockBrandConfig} presets={null} loading onSave={vi.fn()} />);

    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Configuration' })).not.toBeInTheDocument();
  });

  it('confirms a save only once it has completed', async () => {
    render(<BrandConfigContent config={mockBrandConfig} presets={null} loading={false} onSave={vi.fn(() => Promise.resolve())} />);
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    });

    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });
});
