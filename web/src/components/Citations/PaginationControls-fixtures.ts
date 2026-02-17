import { vi } from 'vitest';

const DEFAULTS = {
  currentPage: 1,
  totalPages: 5,
  itemsPerPage: 25,
  totalItems: 120,
  startIndex: 0,
  endIndex: 25,
  showAll: false,
  onPageChange: vi.fn(),
  onItemsPerPageChange: vi.fn(),
} as const;

export function buildProps(overrides = {}) {
  return {
    ...DEFAULTS,
    onPageChange: vi.fn(),
    onItemsPerPageChange: vi.fn(),
    ...overrides,
  };
}
