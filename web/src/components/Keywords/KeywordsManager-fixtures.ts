import { vi } from 'vitest';
import { ApiRequestError } from '../../infrastructure';
import type {
  Keyword, KeywordExtended
} from '../../types';

export const existingKeywordFixture = {
  id: 'keyword-1',
  keyword: 'hotels',
  created_at: '2024-01-01T00:00:00Z',
  status: 'active',
} satisfies Keyword;

export const createdKeywordFixture = {
  id: 'keyword-2',
  keyword: 'resorts',
  created_at: '2024-02-01T00:00:00Z',
  status: 'active',
} satisfies Keyword;

export const extendedCreatedKeywordFixture = {
  ...createdKeywordFixture,
  updated_at: '2024-02-01T00:00:00Z',
  region: 'global',
  language: 'en',
  category: 'hospitality',
  priority: 'high',
  notes: 'Track resort visibility.',
} satisfies KeywordExtended & { updated_at: string };

export const updatedKeywordFixture = {
  ...existingKeywordFixture,
  keyword: 'boutique hotels',
} satisfies Keyword;

export const bulkCreatedKeywordFixture = {
  id: 'keyword-3',
  keyword: 'city hotels',
  created_at: '2024-03-01T00:00:00Z',
  status: 'active',
} satisfies Keyword;

export const malformedKeywordFixture = {
  id: 'keyword-malformed',
  keyword: 'malformed keyword',
  created_at: 42,
};

export const CREATE_CONFLICT_MESSAGE = 'This keyword already exists.';
export const UPDATE_CONFLICT_MESSAGE = 'Rename conflicts with an existing keyword.';
export const BULK_CONFLICT_MESSAGE = 'This bulk keyword already exists.';
export const DELETE_NOT_FOUND_MESSAGE = 'Keyword not found';
export const DELETE_SERVER_MESSAGE = 'Database timeout while deleting keyword.';
export const CREATE_FALLBACK_MESSAGE = 'Failed to add keyword';
export const DELETE_FALLBACK_MESSAGE = 'Failed to delete keyword';
export const FAILED_BULK_KEYWORD = 'coastal hotels';

export function createKeywordsManagerProps(
  keywords: Keyword[] = [existingKeywordFixture]
) {
  return {
    keywords,
    setKeywords: vi.fn<(updatedKeywords: Keyword[]) => void>(),
  };
}

class FixtureApiRequestError extends ApiRequestError {
  readonly responseMessage: string;
  readonly field: string;

  constructor(responseMessage: string, statusCode: number) {
    super(`HTTP ${statusCode}`, statusCode);
    this.responseMessage = responseMessage;
    this.field = 'keyword';
  }
}

class FixtureTransportError extends Error {
  constructor() {
    super('socket closed before a response was received');
    this.name = 'FixtureTransportError';
  }
}

export function createApiRequestError(
  responseMessage: string,
  statusCode = 409
): ApiRequestError {
  return new FixtureApiRequestError(responseMessage, statusCode);
}

export function createTransportError(): Error {
  return new FixtureTransportError();
}
