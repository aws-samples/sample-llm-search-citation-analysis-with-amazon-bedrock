import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  PaginationHeader, type PaginationHeaderProps
} from './PaginationHeader';

/** Page 1 of 5 (25 of 120 citations) with a fresh spy per callback; every prop can be overridden. */
function buildProps(overrides: Partial<PaginationHeaderProps> = {}): PaginationHeaderProps {
  return {
    page: 1,
    pageSize: 25,
    total: 120,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    idPrefix: 'citations',
    label: 'Citations pagination',
    ...overrides,
  };
}

/** Mounts the header over `buildProps(overrides)` and returns the props, for asserting on the spies. */
export function renderPaginationHeader(overrides: Partial<PaginationHeaderProps> = {}): PaginationHeaderProps {
  const props = buildProps(overrides);
  render(<PaginationHeader {...props} />);
  return props;
}

/** The page sizes the "Show:" select offers, as the user reads them. */
export function pageSizeOptionLabels(): string[] {
  return screen.getAllByRole<HTMLOptionElement>('option').map((option) => option.textContent ?? '');
}
