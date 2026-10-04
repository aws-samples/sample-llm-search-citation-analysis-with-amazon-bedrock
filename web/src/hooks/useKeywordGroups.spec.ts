import {
  beforeEach, describe, expect, it, vi 
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useKeywordGroups } from './useKeywordGroups';
import { ApiRequestError } from '../infrastructure';
import {
  buildGroup, buildKeyword
} from '../api/keywordGroups-fixtures';
import { renderLoadedKeywordGroups } from './useKeywordGroups-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';
import { TestAbortError } from '../test/abortError';
import type { KeywordGroup } from '../types';

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
  PartialMembershipUpdateError,
  updateGroupMemberships,
  updateKeywordGroup,
} from '../api/keywordGroups';

const mockFetch = vi.mocked(fetchKeywordGroups);
const mockCreate = vi.mocked(createKeywordGroup);
const mockUpdate = vi.mocked(updateKeywordGroup);
const mockDelete = vi.mocked(deleteKeywordGroup);
const mockMemberships = vi.mocked(updateGroupMemberships);

/** Renders the loaded hook and adds kw-1 to group a, settling the membership change. */
async function renderAfterAddingKw1(options?: Parameters<typeof useKeywordGroups>[0]) {
  const { result } = await renderLoadedKeywordGroups(options);
  return act(() => result.current.changeMemberships('a', { add: ['kw-1'] }));
}

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
    const { result } = await renderLoadedKeywordGroups();

    expect(result.current.groups.map((group) => group.name)).toStrictEqual(['coruña', 'Marino']);
    expect(result.current.error).toBeNull();
  });

  it('exposes the safe keyword message when loading fails with a server error', async () => {
    mockFetch.mockRejectedValue(new ApiRequestError('HTTP 500', 500));

    const { result } = await renderLoadedKeywordGroups();

    expect(result.current.error).toBe('Failed to process keyword request');
  });

  it('keeps the newer list when an older refresh resolves after it', async () => {
    const { result } = await renderLoadedKeywordGroups();
    const [older, newer] = deferNextTwoCalls<KeywordGroup[]>(mockFetch);
    const refreshes = act(async () => {
      await Promise.all([result.current.refresh(), result.current.refresh()]);
    });

    newer.resolve([buildGroup({
      id: 'n',
      name: 'Newer',
    })]);
    older.resolve([buildGroup({
      id: 'o',
      name: 'Older',
    })]);
    await refreshes;

    expect(result.current.groups.map((group) => group.name)).toStrictEqual(['Newer']);
  });

  it('stays loading while a newer refresh is in flight after the superseded mount load settles', async () => {
    const [mountLoad, newer] = deferNextTwoCalls<KeywordGroup[]>(mockFetch);
    const { result } = renderHook(() => useKeywordGroups());
    act(() => {
      void result.current.refresh();
    });

    await act(async () => {
      mountLoad.resolve([]);
    });

    expect(result.current.loading).toBe(true);
    await act(async () => {
      newer.resolve([]);
    });
  });

  it('shows no error when the current request rejects with an abort', async () => {
    mockFetch.mockRejectedValue(new TestAbortError());

    const { result } = await renderLoadedKeywordGroups();

    expect(result.current.error).toBeNull();
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

    await renderAfterAddingKw1({ onKeywordsUpdated });

    expect(mockMemberships).toHaveBeenCalledWith('a', { add: ['kw-1'] });
    expect(onKeywordsUpdated).toHaveBeenCalledWith(updated);
  });

  describe('when a later membership chunk fails', () => {
    const appliedKeywords = [buildKeyword({ group_ids: ['a'] })];
    const partialFailure = new PartialMembershipUpdateError({
      applied: {
        group_id: 'a',
        added: ['kw-1'],
        removed: [],
        missing: [],
        keywords: appliedKeywords,
      },
      appliedChanges: 500,
      totalChanges: 600,
    }, new ApiRequestError('HTTP 500', 500));

    beforeEach(() => {
      mockMemberships.mockRejectedValue(partialFailure);
    });

    it('hands the keywords of the applied chunks to onKeywordsUpdated', async () => {
      const onKeywordsUpdated = vi.fn();

      await renderAfterAddingKw1({ onKeywordsUpdated });

      expect(onKeywordsUpdated).toHaveBeenCalledWith(appliedKeywords);
    });

    it('reports how many memberships were applied before the failure', async () => {
      const outcome = await renderAfterAddingKw1();

      expect(outcome).toStrictEqual({
        success: false,
        message: 'Updated 500 of 600 keyword memberships, then stopped: Failed to process keyword request',
      });
    });

    it('refreshes the group counts because the applied chunks are stored', async () => {
      await renderAfterAddingKw1();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
