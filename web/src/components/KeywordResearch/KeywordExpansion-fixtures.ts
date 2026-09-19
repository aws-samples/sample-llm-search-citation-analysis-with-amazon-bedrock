import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ApiRequestError } from '../../infrastructure';
import type { KeywordExpansion } from './KeywordExpansion';

export const definitiveRejectionMessage = 'Keyword cannot be promoted';
export const definitiveRejectionField = 'keywords[0].keyword';

export function buildProps(
  overrides: Partial<ComponentProps<typeof KeywordExpansion>> = {}
): ComponentProps<typeof KeywordExpansion> {
  return {
    onExpand: vi.fn(),
    loading: false,
    result: null,
    error: null,
    ...overrides,
  };
}

export function createDefinitiveRejection(field?: string): ApiRequestError {
  return new ApiRequestError(definitiveRejectionMessage, {
    statusCode: 400,
    responseMessage: definitiveRejectionMessage,
    ...(field === undefined ? {} : { field }),
  });
}
