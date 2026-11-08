import { vi } from 'vitest';
import type { ExportsCenter } from '../../hooks/useExports';

/** An Exports center whose actions are `vi.fn()`s, for rendering the page and the badge. */
export function buildExportsCenter(overrides: Partial<ExportsCenter> = {}): ExportsCenter {
  return {
    exports: [],
    nextToken: null,
    loading: false,
    loadingMore: false,
    error: null,
    unseenCount: 0,
    toasts: [],
    start: vi.fn(),
    loadMore: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    download: vi.fn(() => Promise.resolve()),
    markAllSeen: vi.fn(),
    dismissToast: vi.fn(),
    ...overrides,
  };
}
