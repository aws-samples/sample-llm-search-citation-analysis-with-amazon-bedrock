import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { IndustrySelector } from './IndustrySelector';
import { buildIndustrySelectorProps } from './IndustrySelector-fixtures';

describe('IndustrySelector', () => {
  it('displays industry options from presets', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps()} />);

    expect(screen.getByRole('combobox')).toHaveValue('hospitality');
    expect(screen.getByText('Hospitality')).toBeInTheDocument();
  });

  it('calls onIndustryChange when selection changes', () => {
    const onIndustryChange = vi.fn();
    render(<IndustrySelector {...buildIndustrySelectorProps({ onIndustryChange })} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'retail' } });

    expect(onIndustryChange).toHaveBeenCalledWith('retail');
  });

  it('displays preset description', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps()} />);

    expect(screen.getByText('Hotels and travel')).toBeInTheDocument();
  });

  it('displays example brands', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps()} />);

    expect(screen.getByText('Marriott, Hilton')).toBeInTheDocument();
  });

  it('shows custom prompt indicator when industry has custom prompt', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps({ industryPrompts: { hospitality: 'custom prompt' } })} />);

    expect(screen.getByText('Hospitality (custom prompt)')).toBeInTheDocument();
  });
});
