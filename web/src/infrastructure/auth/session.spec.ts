import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { authenticatedFetch } from './session';
import { createMockJsonResponse } from '../../test/fetchResponses';

vi.mock('aws-amplify/auth', () => ({fetchAuthSession: vi.fn().mockResolvedValue({ tokens: { idToken: { toString: () => 'id-token' } } }),}));

const API_URL = 'https://api.example.com/prod/api/citations';
const PRESIGNED_URL = 'https://citation-analysis-keywords-123.s3.eu-west-1.amazonaws.com/api-responses/x.json?X-Amz-Signature=abc';
const ORIGINAL_BODY = { top_urls: [{ url: 'https://example.com/a' }] };

function stubSpillPointer(): Response {
  return new Response(JSON.stringify({ spilled_response: { url: PRESIGNED_URL } }), {
    status: 200,
    headers: { 'X-Spilled-Response': 'true' },
  });
}

describe('authenticatedFetch', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
      String(input) === API_URL ? stubSpillPointer() : createMockJsonResponse(ORIGINAL_BODY)
    ));
  });

  it('sends the ID token to the API', async () => {
    await authenticatedFetch(API_URL);

    expect(fetch).toHaveBeenCalledWith(API_URL, { headers: { Authorization: 'Bearer id-token' } });
  });

  it('answers the real body when the API spilled the response to S3', async () => {
    const response = await authenticatedFetch(API_URL);

    await expect(response.json()).resolves.toStrictEqual(ORIGINAL_BODY);
  });

  it('answers an ordinary response unchanged', async () => {
    vi.mocked(fetch).mockResolvedValue(createMockJsonResponse({ ok: true }));

    const response = await authenticatedFetch(API_URL);

    await expect(response.json()).resolves.toStrictEqual({ ok: true });
  });
});
