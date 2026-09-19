import {
  beforeEach, describe, expect, it, vi 
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { useKeywordGroups } from './useKeywordGroups';
import { ApiRequestError } from '../infrastructure';
import {
  buildGroup, buildKeyword
} from '../api/keywordGroups-fixtures';
import { renderLoadedKeywordGroups } from './useKeywordGroups-fixtures';

vi.mock('../api/keywordGroups', async () => {
  const actual = await vi.importActual<typeof import('../api/keywordGroups')>('../api/keywordGroups');
  return {
    ...actual,
    fetchKeywordGroups: vi.fn(),
    createKeywordGroup: vi.fn(),
    updateKeywordGroup: vi.fn(),
    deleteKeywordGroup: vi.fn(),
    updateGroupMemberships: vi.fn(),
  };
});

import {
  createKeywordGroup,
  deleteKeywordGroup,
  fetchKeywordGroups,
  updateGroupMemberships,
  updateKeywordGroup,
} from '../api/keywordGroups';

const mockFetch = vi.mocked(fetchKeywordGroups);
const mockCreate = vi.mocked(createKeywordGroup);
const mockUpdate = vi.mocked(updateKeywordGroup);
const mockDelete = vi.mocked(deleteKeywordGroup);
const mockMemberships = vi.mocked(updateGroupMemberships);

describe('useKeywordGroups', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockFetch.mockResolvedValue([
      buildGroup({
        id: 'b',
        name: 'Marino' 
      }),
      buildGroup({
        id: 'a',
        name: 'coruña' 
      }),
    ]);
  });

  it('loads groups on mount sorted by name ignoring case', async () => {
    const { result } = renderHook(() => useKeywordGroups());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.groups.map((group) => group.name)).toStrictEqual(['coruña', 'Marino']);
    expect(result.current.error).toBeNull();
  });

  it('exposes the safe keyword message when loading fails with a server error', async () => {
    mockFetch.mockRejectedValue(new ApiRequestError('HTTP 500', 500));

    const { result } = renderHook(() => useKeywordGroups());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to process keyword request');
  });

  it('creates a group and refreshes the list', async () => {
    mockCreate.mockResolvedValue(buildGroup({ name: 'New' }));
    const { result } = await renderLoadedKeywordGroups();

    const outcome = await act(() => result.current.createGroup('New'));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Group "New" created' 
    });
    expect(mockCreate).toHaveBeenCalledWith('New', '');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reports the backend conflict message for a failed rename without refreshing', async () => {
    mockUpdate.mockRejectedValue(new ApiRequestError('HTTP 409', {
      statusCode: 409,
      responseMessage: 'A keyword group with this name already exists',
    }));
    const { result } = await renderLoadedKeywordGroups();

    const outcome = await act(() => result.current.renameGroup('a', 'Marino'));

    expect(outcome).toStrictEqual({
      success: false,
      message: 'A keyword group with this name already exists' 
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('deletes a group through the client', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { result } = await renderLoadedKeywordGroups();

    await act(async () => {
      await result.current.removeGroup('a');
    });

    expect(mockDelete).toHaveBeenCalledWith('a');
  });

  it('hands the updated keywords to onKeywordsUpdated after a membership change', async () => {
    const updated = [buildKeyword({ group_ids: ['a'] })];
    mockMemberships.mockResolvedValue({
      group_id: 'a',
      added: ['kw-1'],
      removed: [],
      missing: [],
      keywords: updated,
    });
    const onKeywordsUpdated = vi.fn();
    const { result } = await renderLoadedKeywordGroups({ onKeywordsUpdated });

    await act(async () => {
      await result.current.changeMemberships('a', { add: ['kw-1'] });
    });

    expect(mockMemberships).toHaveBeenCalledWith('a', { add: ['kw-1'] });
    expect(onKeywordsUpdated).toHaveBeenCalledWith(updated);
  });
});
