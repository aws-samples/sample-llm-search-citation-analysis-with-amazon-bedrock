import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { BrandMentionsTable } from './BrandMentionsTable';
import { brandMentionsExportResponse } from './brandMentionsExport-fixtures';

describe('BrandMentionsTable', () => {
  it.each([
    ['OPE', 'OpenAI'],
    ['GEM', 'Google Gemini'],
  ])('titles the %s provider chip with the display name %s', (chip, name) => {
    render(<BrandMentionsTable brands={brandMentionsExportResponse.aggregated.brands} keyword="hotel coruna spa" onBrandClick={vi.fn()} />);

    expect(screen.getAllByText(chip)[0]).toHaveAttribute('title', name);
  });
});
