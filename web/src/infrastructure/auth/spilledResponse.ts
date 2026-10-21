/**
 * Follows the API's spill pointer back to the original response body.
 *
 * A Lambda response is capped at 6 MiB. When one would be larger, the API
 * writes the body to S3 and answers, with the original status, a small
 * pointer instead (`lambda/shared/response_spill.py`):
 *
 *     X-Spilled-Response: true
 *     {"spilled_response": {"url": "<presigned S3 GET>", "size_bytes": n, "expires_in": 300}}
 *
 * `followSpilledResponse` downloads the body from the presigned URL, which
 * carries its own authorization, so the request sends no token or cookie, and
 * hands callers a `Response` with the original status and the real body.
 */
import { ApiRequestError } from '../errors';
import { isRecord } from '../../types/domain/keywordDecoders';

/** The header that marks a spill pointer. */
export const SPILL_HEADER = 'X-Spilled-Response';

/** Presigned S3 URLs live on this domain; a pointer to anywhere else is refused. */
const SPILL_HOST_SUFFIX = '.amazonaws.com';

const SPILL_FAILURE_MESSAGE = 'The response was too large to load. Narrow the request and try again.';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The presigned URL of a spill pointer body, or `null` when the body is not a well-formed pointer. */
export function spilledResponseUrl(body: unknown): URL | null {
  if (!isRecord(body) || Object.keys(body).length !== 1 || !isRecord(body.spilled_response)) return null;
  const { url } = body.spilled_response;
  const parsed = typeof url === 'string' ? parseUrl(url) : null;
  if (parsed === null) return null;
  return parsed.protocol === 'https:' && parsed.hostname.endsWith(SPILL_HOST_SUFFIX) ? parsed : null;
}

/** Whether `response` is a spill pointer rather than the body itself. */
export function isSpilledResponse(response: Response): boolean {
  return response.headers.get(SPILL_HEADER) === 'true';
}

/**
 * The original response behind a spill pointer: same status, the body read
 * from S3. Rejects with an `ApiRequestError` when the pointer is malformed or
 * the download fails (an abort rejects as the abort).
 */
export async function followSpilledResponse(pointer: Response, signal?: AbortSignal | null): Promise<Response> {
  const location = spilledResponseUrl(await pointer.json());
  if (location === null) {
    throw new ApiRequestError(SPILL_FAILURE_MESSAGE, { statusCode: pointer.status });
  }
  const download = await fetch(location, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!download.ok) {
    throw new ApiRequestError(SPILL_FAILURE_MESSAGE, { statusCode: download.status });
  }
  return new Response(await download.text(), {
    status: pointer.status,
    statusText: pointer.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}
