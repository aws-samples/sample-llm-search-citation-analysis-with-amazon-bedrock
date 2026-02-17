import { vi } from 'vitest';

const DEFAULTS = {
  searchQuery: '',
  setSearchQuery: vi.fn(),
  minCitations: '' as number | '',
  setMinCitations: vi.fn(),
  setCurrentPage: vi.fn(),
  onDownloadExcel: vi.fn(),
} as const;

export function buildProps(overrides = {}) {
  return {
    ...DEFAULTS,
    setSearchQuery: vi.fn(),
    setMinCitations: vi.fn(),
    setCurrentPage: vi.fn(),
    onDownloadExcel: vi.fn(),
    ...overrides,
  };
}
