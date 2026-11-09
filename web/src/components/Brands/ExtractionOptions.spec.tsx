import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { ExtractionOptions } from './ExtractionOptions';
import {
  fieldIdentity, labelledFieldIdentity
} from '../../test/fieldIdentity';

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

    expect(checkboxes.map(fieldIdentity)).toStrictEqual([
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
    expect(labelledFieldIdentity('Max brands per response:')).toStrictEqual({
      id: 'brands-extraction-max-brands',
      labelFor: 'brands-extraction-max-brands',
      name: 'brands-extraction-max-brands',
    });
  });
});
