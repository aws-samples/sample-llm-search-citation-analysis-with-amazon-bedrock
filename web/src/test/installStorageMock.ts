import type { StorageMock } from './storageMock';

/** Empties `mock` (without recording a `clear` call) and makes it `window.localStorage`. */
export function installStorageMock(mock: StorageMock): void {
  Object.keys(mock.store).forEach((key) => delete mock.store[key]);
  Object.defineProperty(window, 'localStorage', {
    value: mock,
    writable: true,
  });
}
