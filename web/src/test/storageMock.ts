import { vi } from 'vitest';

export interface StorageMock {
  store: Record<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

export function createStorageMock(): StorageMock {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string): void => {
      store[key] = value;
    }),
    clear: vi.fn((): void => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
}

/**
 * Dispatch the `storage` event another tab's write to `key` raises (`null` = a `clear()`).
 *
 * Built with `Reflect.construct` because CodeQL's bundled DOM externs still
 * model `StorageEvent(type)` with one parameter and report the (standard)
 * `eventInitDict` argument as superfluous (js/superfluous-trailing-arguments).
 */
export function dispatchStorageEvent(key: string | null): void {
  const event: StorageEvent = Reflect.construct(StorageEvent, ['storage', { key }]);
  globalThis.dispatchEvent(event);
}
