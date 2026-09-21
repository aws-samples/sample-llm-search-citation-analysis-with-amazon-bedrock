import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  builtinCreateTemplate,
  renderLoadedContentBriefTemplatesInStrictMode,
  savedUrbanTemplate,
  templateListResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(
    createMockJsonResponse(templateListResponse([
      builtinCreateTemplate,
      savedUrbanTemplate,
    ]))
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
