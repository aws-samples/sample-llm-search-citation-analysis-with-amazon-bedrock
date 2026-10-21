import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  followSpilledResponse, isSpilledResponse, spilledResponseUrl
} from './spilledResponse';
import { ApiRequestError } from '../errors';
import { createMockJsonResponse } from '../../test/fetchResponses';

const PRESIGNED_URL = 'https://citation-analysis-keywords-123.s3.eu-west-1.amazonaws.com/api-responses/x.json?X-Amz-Signature=abc';
const ORIGINAL_BODY = { top_urls: [{ url: 'https://example.com/a' }] };

function stubPointer(url: string = PRESIGNED_URL, status = 200): Response {
  return new Response(JSON.stringify({
    spilled_response: {
      url,
      size_bytes: 7_340_032,
      expires_in: 300,
    },
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Spilled-Response': 'true',
    },
  });
}

describe('spilledResponseUrl', () => {
  it('returns the presigned URL of a well-formed pointer', () => {
    expect(spilledResponseUrl({ spilled_response: { url: PRESIGNED_URL } })?.href).toBe(PRESIGNED_URL);
  });

  it.each([
    ['a non-https URL', { spilled_response: { url: 'sftp://bucket.s3.amazonaws.com/x' } }],
    ['a host outside amazonaws.com', { spilled_response: { url: 'https://evil.example/x' } }],
    ['a lookalike host', { spilled_response: { url: 'https://s3.amazonaws.com.evil.example/x' } }],
    ['a URL that does not parse', { spilled_response: { url: 'not a url' } }],
    ['extra keys beside the pointer', {
      spilled_response: { url: PRESIGNED_URL },
      top_urls: [],
    }],
    ['a pointer that is not an object', { spilled_response: PRESIGNED_URL }],
    ['an ordinary body', ORIGINAL_BODY],
    ['null', null],
  ])('returns null for %s', (_label, body) => {
    expect(spilledResponseUrl(body)).toBeNull();
  });
});

describe('isSpilledResponse', () => {
  it('recognises the spill header', () => {
    expect(isSpilledResponse(stubPointer())).toBe(true);
  });

  it('treats a response without the header as the body itself', () => {
    expect(isSpilledResponse(createMockJsonResponse(ORIGINAL_BODY))).toBe(false);
  });
});

describe('followSpilledResponse', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockJsonResponse(ORIGINAL_BODY));
  });

  it('answers the body read from the presigned URL', async () => {
    const response = await followSpilledResponse(stubPointer());

    await expect(response.json()).resolves.toStrictEqual(ORIGINAL_BODY);
  });

  it('keeps the status of the original response', async () => {
    const response = await followSpilledResponse(stubPointer(PRESIGNED_URL, 201));

    expect(response.status).toBe(201);
  });

  it('downloads without credentials or a referrer, passing the abort signal', async () => {
    const controller = new AbortController();

    await followSpilledResponse(stubPointer(), controller.signal);

    expect(fetch).toHaveBeenCalledWith(new URL(PRESIGNED_URL), {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('rejects without downloading when the pointer names a foreign host', async () => {
    await expect(followSpilledResponse(stubPointer('https://evil.example/x'))).rejects.toThrow(ApiRequestError);
    expect(fetch).not.toHaveBeenCalledWith(new URL('https://evil.example/x'), expect.anything());
  });

  it('rejects with the download status when S3 refuses the URL', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('expired', { status: 403 }));

    await expect(followSpilledResponse(stubPointer())).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 403,
    });
  });
});
