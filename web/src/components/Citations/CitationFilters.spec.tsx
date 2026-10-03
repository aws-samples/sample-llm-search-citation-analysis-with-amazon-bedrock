import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { CitationFilters } from './CitationFilters';
import { buildProps } from './CitationFilters-fixtures';

/** Renders the filters from `buildProps(overrides)` and returns those props (with their spies). */
function renderCitationFilters(overrides: Parameters<typeof buildProps>[0] = {}) {
  const props = buildProps(overrides);
  render(<CitationFilters {...props} />);
  return props;
}

describe('CitationFilters', () => {
  it('calls setSearchQuery and resets page when search input changes', () => {
    const props = renderCitationFilters();

    fireEvent.change(screen.getByPlaceholderText('Filter by URL...'), { target: { value: 'example.com' } });

    expect(props.setSearchQuery).toHaveBeenCalledWith('example.com');
    expect(props.setCurrentPage).toHaveBeenCalledWith(1);
  });

  it('calls setMinCitations with parsed number when min citations input changes', () => {
    const props = renderCitationFilters();

    fireEvent.change(screen.getByPlaceholderText('Any'), { target: { value: '5' } });

    expect(props.setMinCitations).toHaveBeenCalledWith(5);
    expect(props.setCurrentPage).toHaveBeenCalledWith(1);
  });

  it('calls setMinCitations with empty string when input cleared', () => {
    const props = renderCitationFilters({ minCitations: 5 });

    fireEvent.change(screen.getByPlaceholderText('Any'), { target: { value: '' } });

    expect(props.setMinCitations).toHaveBeenCalledWith('');
  });

  it('clears all filters and resets page when Clear button clicked', () => {
    const props = renderCitationFilters({
      searchQuery: 'test',
      minCitations: 3 
    });

    fireEvent.click(screen.getByText('Clear'));

    expect(props.setSearchQuery).toHaveBeenCalledWith('');
    expect(props.setMinCitations).toHaveBeenCalledWith('');
    expect(props.setCurrentPage).toHaveBeenCalledWith(1);
  });

  it('calls onDownloadExcel when Export button clicked', () => {
    const props = renderCitationFilters();

    fireEvent.click(screen.getByText('Export'));

    expect(props.onDownloadExcel).toHaveBeenCalledTimes(1);
  });

  it('displays current search query value', () => {
    renderCitationFilters({ searchQuery: 'existing query' });

    expect(screen.getByPlaceholderText('Filter by URL...')).toHaveValue('existing query');
  });

  it('displays current min citations value', () => {
    renderCitationFilters({ minCitations: 10 });

    expect(screen.getByPlaceholderText('Any')).toHaveValue(10);
  });
});
