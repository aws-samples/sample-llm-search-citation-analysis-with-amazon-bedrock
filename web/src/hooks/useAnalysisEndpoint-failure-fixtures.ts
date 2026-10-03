import type { EndpointMockFetchOptions } from '../test/fetchResponses';

/**
 * Failure rows for `describeEndpointHookContract` that the visibility-context
 * endpoint hooks share: the message the hook reports, the failure it reports
 * it for, and how the mocked endpoint fails.
 */
type VisibilityFailureCase = [message: string, failure: string, options: EndpointMockFetchOptions<never>];

export const FAILED_TO_LOAD_ON_NON_OK_STATUS: VisibilityFailureCase = [
  'Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true },
];

export const UNABLE_TO_LOAD_ON_NON_OK_STATUS: VisibilityFailureCase = [
  'Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true },
];

export const INVALID_REQUEST_ON_TYPE_GUARD_FAILURE: VisibilityFailureCase = [
  'Invalid visibility request', 'payload fails the type guard', { invalidResponse: true },
];

/** The backend answers OK with an `{ error }` body carrying `error`. */
export function failedToLoadOnBackendError(error: string): VisibilityFailureCase {
  return ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error } }];
}

/**
 * The bodies every analysis response guard must reject, whatever its shape:
 * a body that is not an object, and the full `body` flagged with a
 * non-string `error` (a string one is rejected before the guard).
 */
export function rejectedBodiesFor(body: object, errorMessage: string): Array<[description: string, body: unknown]> {
  return [
    ['a null body', null],
    ['a full body flagged with a structured error', {
      ...body,
      error: { message: errorMessage },
    }],
  ];
}
