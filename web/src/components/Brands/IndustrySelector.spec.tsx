import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { IndustrySelector } from './IndustrySelector';
import {
  buildIndustrySelectorProps, chooseRetailIndustry 
} from './IndustrySelector-fixtures';

describe('IndustrySelector', () => {
  it('displays industry options from presets', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps()} />);

    expect(screen.getByRole('combobox')).toHaveValue('hospitality');
    expect(screen.getByText('Hospitality')).toBeInTheDocument();
  });

  it('calls onIndustryChange when selection changes', () => {
    const onIndustryChange = vi.fn();
    render(<IndustrySelector {...buildIndustrySelectorProps({ onIndustryChange })} />);

    chooseRetailIndustry();

    expect(onIndustryChange).toHaveBeenCalledWith('retail');
  });

  it.each([
    ['preset description', 'Hotels and travel'],
    ['example brands', 'Marriott, Hilton'],
  ])('displays %s', (_detail, text) => {
    render(<IndustrySelector {...buildIndustrySelectorProps()} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows custom prompt indicator when industry has custom prompt', () => {
    render(<IndustrySelector {...buildIndustrySelectorProps({ industryPrompts: { hospitality: 'custom prompt' } })} />);

    expect(screen.getByText('Hospitality (custom prompt)')).toBeInTheDocument();
  });
});
