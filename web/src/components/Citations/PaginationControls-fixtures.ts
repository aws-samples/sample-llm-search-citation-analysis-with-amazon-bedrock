import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { PaginationControls } from './PaginationControls';

type PaginationControlsProps = ComponentProps<typeof PaginationControls>;

/** Page 1 of 5 (25 of 120 items) with a fresh spy per callback; every prop can be overridden. */
export function buildProps(overrides: Partial<PaginationControlsProps> = {}): PaginationControlsProps {
  return {
    currentPage: 1,
    totalPages: 5,
    itemsPerPage: 25,
    totalItems: 120,
    startIndex: 0,
    endIndex: 25,
    showAll: false,
    onPageChange: vi.fn(),
    onItemsPerPageChange: vi.fn(),
    ...overrides,
  };
}
