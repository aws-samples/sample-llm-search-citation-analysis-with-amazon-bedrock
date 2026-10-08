import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { CitationFilters } from './CitationFilters';

type CitationFiltersProps = ComponentProps<typeof CitationFilters>;

/** Empty filters with a fresh spy per callback; every prop can be overridden. */
export function buildProps(overrides: Partial<CitationFiltersProps> = {}): CitationFiltersProps {
  return {
    searchQuery: '',
    setSearchQuery: vi.fn(),
    minCitations: '',
    setMinCitations: vi.fn(),
    contentType: 'all',
    setContentType: vi.fn(),
    setCurrentPage: vi.fn(),
    onDownloadExcel: vi.fn(),
    ...overrides,
  };
}
