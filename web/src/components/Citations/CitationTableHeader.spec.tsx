import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { CitationTableHeader } from './CitationTableHeader';
import type { SortConfig } from '../../exporters/citationParser';
import {
  DESC_CITATIONS, DESC_KEYWORDS
} from '../../exporters/citationParser-fixtures';

/** Renders the header inside a table, sorted by `sort`; returns its `onSort` spy. */
function renderHeader(sort: SortConfig = DESC_CITATIONS) {
  const onSort = vi.fn();
  render(<table><CitationTableHeader sort={sort} onSort={onSort} /></table>);
  return onSort;
}

describe('CitationTableHeader', () => {
  it('displays #, URL, and Domain column headers', () => {
    renderHeader();

    expect(screen.getByText('#')).toBeInTheDocument();
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Domain')).toBeInTheDocument();
  });

  it('displays Keywords and Citations column headers', () => {
    renderHeader();

    expect(screen.getByText('Keywords')).toBeInTheDocument();
    expect(screen.getByText('Citations')).toBeInTheDocument();
  });

  it.each([
    ['keywords', 'Keywords', DESC_CITATIONS],
    ['citations', 'Citations', DESC_KEYWORDS],
    ['domain', 'Domain', DESC_CITATIONS],
  ])('calls onSort with %s when %s header clicked', (column, header, sort) => {
    const onSort = renderHeader(sort);

    fireEvent.click(screen.getByText(header));
    expect(onSort).toHaveBeenCalledWith(column);
  });

  it('shows sort indicator for active sort column', () => {
    renderHeader(DESC_KEYWORDS);

    const keywordsHeader = screen.getByText('Keywords').closest('th');
    expect(keywordsHeader?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows no sort indicator on the inactive columns', () => {
    renderHeader(DESC_KEYWORDS);

    expect(screen.getByText('Citations').closest('th')?.querySelector('svg')).toBeNull();
  });

  it('draws a different indicator for an ascending sort than for a descending one', () => {
    const { container: descending } = render(<table><CitationTableHeader sort={DESC_KEYWORDS} onSort={vi.fn()} /></table>);
    const { container: ascending } = render(<table><CitationTableHeader sort={{
      ...DESC_KEYWORDS,
      direction: 'asc',
    }} onSort={vi.fn()} /></table>);

    const ascendingIcon = ascending.querySelector('path')?.getAttribute('d') ?? '';

    expect(ascendingIcon).toBe('M5 15l7-7 7 7');
    expect(descending.querySelector('path')?.getAttribute('d')).not.toBe(ascendingIcon);
  });
});
