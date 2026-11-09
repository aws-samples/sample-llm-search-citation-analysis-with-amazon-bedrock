import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { BrandMentionsTable } from './BrandMentionsTable';
import { brandMentionsExportResponse } from './brandMentionsExport-fixtures';

function renderTable(keyword = 'hotel coruna spa', singleKeyword?: boolean) {
  render(<BrandMentionsTable brands={brandMentionsExportResponse.aggregated.brands} keyword={keyword} singleKeyword={singleKeyword} onBrandClick={vi.fn()} />);
}

/** The table's two brands as the first page of 140, more to load. */
function renderFirstPageOf140() {
  render(<BrandMentionsTable brands={brandMentionsExportResponse.aggregated.brands} totalBrands={140} moreToLoad keyword="hotels" singleKeyword={false} onBrandClick={vi.fn()} />);
}

describe('BrandMentionsTable', () => {
  it.each(['OpenAI', 'Google Gemini'])('names the %s provider chip in full', (name) => {
    renderTable();

    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });

  it.each([
    [true, 'Keyword:'],
    [false, 'Scope:'],
  ])('labels the subject as a keyword or a scope (single keyword: %s)', (singleKeyword, label) => {
    renderTable('Hotel Coruña', singleKeyword);

    expect(screen.getByText('Hotel Coruña').parentElement).toHaveTextContent(`${label} Hotel Coruña`);
  });

  it('marks the active sort button as pressed', () => {
    renderTable();

    expect(screen.getByRole('button', { name: 'By Rank' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('counts every brand when all are loaded', () => {
    renderTable();

    expect(screen.getByText(/2 brands found/)).toBeInTheDocument();
  });

  it('says how many brands are loaded while more remain', () => {
    renderFirstPageOf140();

    expect(screen.getByText(/Showing 2 of 140 brands · more load as you scroll/)).toBeInTheDocument();
  });

  it('says the providers sort covers only the loaded brands while more remain', () => {
    renderFirstPageOf140();

    fireEvent.click(screen.getByRole('button', { name: 'By Providers' }));

    expect(screen.getByText(/sorted among the loaded brands; scroll for more/)).toBeInTheDocument();
  });
});
