import {
  expect, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '../../infrastructure';
import { buildGroup } from '../../api/keywordGroups-fixtures';
import type {
  Keyword, KeywordExtended, KeywordGroup
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

/** Asserts that the mocked API call (`apiPost`, `apiPut`) was never sent with a body and options. */
export function expectNoRequest(apiMock: unknown): void {
  expect(apiMock).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything());
}

/** The single-entry field of the add bar. */
export function getNewKeywordInput(): HTMLElement {
  return screen.getByRole('textbox', { name: 'New keyword' });
}

export async function submitCreate(keyword = createdKeywordFixture.keyword) {
  const user = userEvent.setup();
  const input = getNewKeywordInput();
  await user.type(input, keyword);
  await user.click(screen.getByRole('button', { name: 'Add' }));
  return input;
}

/** Opens the "⋯" menu named `menuLabel` and picks the item named `action`. */
export async function chooseMenuAction(menuLabel: string, action: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: menuLabel }));
  await user.click(screen.getByRole('menuitem', { name: action }));
}

/** Opens the "⋯" menu of `keyword`'s row and picks the item named `action`. */
export async function chooseKeywordAction(keyword: string, action: string): Promise<void> {
  await chooseMenuAction(`Actions for ${keyword}`, action);
}

/** Picks `label` in the table's status filter. */
export async function chooseStatusFilter(label: 'All statuses' | 'Active keywords' | 'Paused keywords'): Promise<void> {
  await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), label);
}

/** Edit the existing keyword, rename it to `newKeyword` and save. */
export async function submitUpdate(newKeyword = updatedKeywordFixture.keyword) {
  const user = userEvent.setup();
  await chooseKeywordAction(existingKeywordFixture.keyword, 'Edit');

  const input = screen.getByDisplayValue(existingKeywordFixture.keyword);
  await user.clear(input);
  await user.type(input, newKeyword);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  return input;
}

export async function submitDelete(): Promise<void> {
  await chooseKeywordAction(existingKeywordFixture.keyword, 'Delete');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }));
}

export async function submitBulk() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Paste a list' }));
  const input = screen.getByPlaceholderText('Enter multiple keywords (one per line)');
  await user.type(
    input,
    `${bulkCreatedKeywordFixture.keyword}\n${FAILED_BULK_KEYWORD}`
  );
  await user.click(screen.getByRole('button', { name: 'Add all' }));
  return input;
}

/** The group the group-count specs add keywords to and delete them from. */
export function buildSevilleGroup(keywordCount: number): KeywordGroup {
  return buildGroup({
    id: 'seville',
    name: 'Seville',
    keyword_count: keywordCount,
  });
}
