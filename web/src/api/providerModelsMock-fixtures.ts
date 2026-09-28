/**
 * Shared replacement for `./providerModels` in component specs:
 *
 * ```ts
 * vi.mock('../../api/providerModels', () => import('../../api/providerModelsMock-fixtures'));
 * import { mockFetchProviderModels } from '../../api/providerModelsMock-fixtures';
 * ```
 */
import { vi } from 'vitest';
import type {
  fetchProviderModels, saveProviderModel
} from './providerModels';

/**
 * Stands in for the real class. Re-exporting it from `./providerModels` would
 * make this factory import the very module it replaces, and Vitest waits on
 * that import forever.
 */
export class ProviderModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderModelError';
  }
}

export const mockFetchProviderModels = vi.fn<typeof fetchProviderModels>();
export const mockSaveProviderModel = vi.fn<typeof saveProviderModel>();

export {
  mockFetchProviderModels as fetchProviderModels,
  mockSaveProviderModel as saveProviderModel,
};
