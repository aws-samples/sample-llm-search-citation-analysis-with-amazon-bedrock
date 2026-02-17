import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { IndustrySelector } from './IndustrySelector';

const presets = {
  hospitality: {
    name: 'Hospitality',
    description: 'Hotels and travel',
    example_brands: ['Marriott', 'Hilton'],
    entity_types: ['hotel'],
    extraction_focus: 'brands',
    default_prompt: 'test' 
  },
  retail: {
    name: 'Retail',
    description: 'Retail stores',
    example_brands: ['Amazon', 'Walmart'],
    entity_types: ['store'],
    extraction_focus: 'brands',
    default_prompt: 'test' 
  },
};

describe('IndustrySelector', () => {
  it('displays industry options from presets', () => {
    render(
      <IndustrySelector
        industry="hospitality"
        presets={presets}
        industryPrompts={{}}
        currentPreset={presets.hospitality}
        onIndustryChange={vi.fn()}
      />
    );
    expect(screen.getByRole('combobox')).toHaveValue('hospitality');
    expect(screen.getByText('Hospitality')).toBeInTheDocument();
  });

  it('calls onIndustryChange when selection changes', () => {
    const onIndustryChange = vi.fn();
    render(
      <IndustrySelector
        industry="hospitality"
        presets={presets}
        industryPrompts={{}}
        currentPreset={presets.hospitality}
        onIndustryChange={onIndustryChange}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'retail' } });
    expect(onIndustryChange).toHaveBeenCalledWith('retail');
  });

  it('displays preset description', () => {
    render(
      <IndustrySelector
        industry="hospitality"
        presets={presets}
        industryPrompts={{}}
        currentPreset={presets.hospitality}
        onIndustryChange={vi.fn()}
      />
    );
    expect(screen.getByText('Hotels and travel')).toBeInTheDocument();
  });

  it('displays example brands', () => {
    render(
      <IndustrySelector
        industry="hospitality"
        presets={presets}
        industryPrompts={{}}
        currentPreset={presets.hospitality}
        onIndustryChange={vi.fn()}
      />
    );
    expect(screen.getByText('Marriott, Hilton')).toBeInTheDocument();
  });

  it('shows custom prompt indicator when industry has custom prompt', () => {
    render(
      <IndustrySelector
        industry="hospitality"
        presets={presets}
        industryPrompts={{ hospitality: 'custom prompt' }}
        currentPreset={presets.hospitality}
        onIndustryChange={vi.fn()}
      />
    );
    expect(screen.getByText('Hospitality (custom prompt)')).toBeInTheDocument();
  });
});
