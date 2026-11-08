import {
  describe, expect, it, vi
} from 'vitest';
import { validateProviderKey } from './providerKeys';
import { mockApiPost } from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('validateProviderKey', () => {
  it('posts the key to the provider validate route and reads 400 refusals', async () => {
    mockApiPost.mockResolvedValue({ valid: true });

    await validateProviderKey('dataforseo', 'seo@example.com:pa55word');

    expect(mockApiPost).toHaveBeenCalledWith(
      '/providers/dataforseo/validate',
      { api_key: 'seo@example.com:pa55word' },
      { acceptedJsonStatuses: [400] },
    );
  });

  it('returns a passed check when the provider accepted the key', async () => {
    mockApiPost.mockResolvedValue({ valid: true });

    await expect(validateProviderKey('dataforseo', 'a:b')).resolves.toStrictEqual({ valid: true });
  });

  it.each([
    ['the provider reason when it rejected the key', {
      valid: false,
      error: 'DataForSEO rejected the login',
    }, 'DataForSEO rejected the login'],
    ['the server refusal', { error: 'API key required' }, 'API key required'],
  ])('returns %s as a failed check', async (_case, answer, reason) => {
    mockApiPost.mockResolvedValue(answer);

    await expect(validateProviderKey('dataforseo', 'a:b')).resolves.toStrictEqual({
      valid: false,
      error: reason,
    });
  });
});
