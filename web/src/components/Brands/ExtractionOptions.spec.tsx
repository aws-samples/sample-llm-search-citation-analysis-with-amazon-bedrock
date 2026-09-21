import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { ExtractionOptions } from './ExtractionOptions';

describe('ExtractionOptions', () => {
  it('associates every extraction field with a brands-specific identity', () => {
    render(
      <ExtractionOptions
        includeSentiment
        includeRankingContext={false}
        maxBrands={20}
        onSentimentChange={vi.fn()}
        onRankingContextChange={vi.fn()}
        onMaxBrandsChange={vi.fn()}
      />
    );

    const checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    const maxBrands = screen.getByLabelText<HTMLInputElement>('Max brands per response:');

    expect(checkboxes.map((checkbox) => ({
      id: checkbox.id,
      labelFor: checkbox.labels?.[0]?.htmlFor,
      name: checkbox.name,
    }))).toStrictEqual([
      {
        id: 'brands-extraction-include-sentiment',
        labelFor: 'brands-extraction-include-sentiment',
        name: 'brands-extraction-include-sentiment',
      },
      {
        id: 'brands-extraction-include-ranking-context',
        labelFor: 'brands-extraction-include-ranking-context',
        name: 'brands-extraction-include-ranking-context',
      },
    ]);
    expect({
      id: maxBrands.id,
      labelFor: maxBrands.labels?.[0]?.htmlFor,
      name: maxBrands.name,
    }).toStrictEqual({
      id: 'brands-extraction-max-brands',
      labelFor: 'brands-extraction-max-brands',
      name: 'brands-extraction-max-brands',
    });
  });
});
