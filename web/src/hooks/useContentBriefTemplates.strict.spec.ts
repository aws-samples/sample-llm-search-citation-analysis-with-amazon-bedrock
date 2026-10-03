import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  builtinCreateTemplate,
  renderLoadedContentBriefTemplatesInStrictMode,
  savedUrbanTemplate,
  templateListJsonResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(
    templateListJsonResponse([builtinCreateTemplate, savedUrbanTemplate])
  ));
});

describe('useContentBriefTemplates StrictMode lifecycle', () => {
  it('stores the authoritative initial template list after effect replay', async () => {
    const { result } = await renderLoadedContentBriefTemplatesInStrictMode();

    expect(result.current.templates).toStrictEqual([
      builtinCreateTemplate,
      savedUrbanTemplate,
    ]);
    expect(result.current.error).toBeNull();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });
});
