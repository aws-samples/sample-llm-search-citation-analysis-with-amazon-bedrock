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
