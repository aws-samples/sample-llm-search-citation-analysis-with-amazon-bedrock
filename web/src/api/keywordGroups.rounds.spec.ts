import {
  describe, expect, it, vi
} from 'vitest';
import {
  deleteKeywordGroup,
  PartialMembershipUpdateError,
  updateGroupMemberships,
} from './keywordGroups';
import {
  buildDeletionResponse,
  buildKeyword,
  buildMembershipResponse,
  sentDeleteOptions,
  sentPutBodies,
} from './keywordGroups-fixtures';
import {
  mockApiDelete, mockApiPut
} from './clientMock-fixtures';
import {
  IncompleteWriteError, MAX_WRITE_ROUNDS
} from './writeRounds';
import { ApiRequestError } from '../infrastructure';

vi.mock('./client', () => import('./clientMock-fixtures'));

const notFound = new ApiRequestError('Keyword group not found', 404);
const abort = new DOMException('The operation was aborted.', 'AbortError');

describe('deleteKeywordGroup rounds', () => {
  it('sends the DELETE again while the answer says members are pending', async () => {
    mockApiDelete
      .mockResolvedValueOnce(buildDeletionResponse(40))
      .mockResolvedValueOnce(buildDeletionResponse(12))
      .mockResolvedValueOnce(buildDeletionResponse());

    await deleteKeywordGroup('group-coruna');

    expect(mockApiDelete).toHaveBeenCalledTimes(3);
  });

  it('treats a repeat answering 404 as a finished delete', async () => {
    mockApiDelete.mockResolvedValueOnce(buildDeletionResponse(5)).mockRejectedValueOnce(notFound);

    await expect(deleteKeywordGroup('group-coruna')).resolves.toBeUndefined();
  });

  it('rejects with the 404 when the first DELETE finds no group', async () => {
    mockApiDelete.mockRejectedValueOnce(notFound);

    await expect(deleteKeywordGroup('ghost')).rejects.toBe(notFound);
  });

  it('stops after ten requests and names the members still listing the group', async () => {
    mockApiDelete.mockResolvedValue(buildDeletionResponse(7));

    const failure = await deleteKeywordGroup('group-coruna').catch((error: unknown) => error);

    expect(mockApiDelete).toHaveBeenCalledTimes(MAX_WRITE_ROUNDS);
    expect(failure).toBeInstanceOf(IncompleteWriteError);
    expect(failure).toMatchObject({
      pendingCount: 7,
      message: 'Group deleted, but 7 keywords still list it after 10 attempts. Delete the group again to finish.',
    });
  });

  it('says some keywords are left when the answer carries no count', async () => {
    mockApiDelete.mockResolvedValue({ truncated: true });

    await expect(deleteKeywordGroup('group-coruna')).rejects.toThrow('Group deleted, but some keywords still list it');
  });

  it('stops the rounds when the request is aborted', async () => {
    const controller = new AbortController();
    mockApiDelete.mockResolvedValueOnce(buildDeletionResponse(5)).mockRejectedValueOnce(abort);

    await expect(deleteKeywordGroup('group-coruna', controller.signal)).rejects.toBe(abort);
    expect(mockApiDelete).toHaveBeenCalledTimes(2);
  });

  it('sends the caller signal with every round', async () => {
    const controller = new AbortController();
    mockApiDelete.mockResolvedValueOnce(buildDeletionResponse(5)).mockResolvedValueOnce(buildDeletionResponse());

    await deleteKeywordGroup('group-coruna', controller.signal);

    expect(sentDeleteOptions()).toStrictEqual([
      {
        allowStructured4xx: true,
        signal: controller.signal,
      },
      {
        allowStructured4xx: true,
        signal: controller.signal,
      },
    ]);
  });
});

const firstRound = buildMembershipResponse({
  added: ['kw-1'],
  removed: ['kw-9'],
  pending: ['kw-2', 'kw-8'],
  truncated: true,
  keywords: [buildKeyword({ id: 'kw-1' })],
});
const secondRound = buildMembershipResponse({
  added: ['kw-2'],
  removed: ['kw-8'],
  pending: [],
  truncated: false,
  keywords: [buildKeyword({ id: 'kw-2' })],
});
const changes = {
  add: ['kw-1', 'kw-2'],
  remove: ['kw-8', 'kw-9'],
};

describe('updateGroupMemberships rounds', () => {
  it('re-sends only the pending ids, each in the list it came from', async () => {
    mockApiPut.mockResolvedValueOnce(firstRound).mockResolvedValueOnce(secondRound);

    await updateGroupMemberships('group-coruna', changes);

    expect(sentPutBodies()).toStrictEqual([changes, {
      add: ['kw-2'],
      remove: ['kw-8'],
    }]);
  });

  it('merges every round into one outcome', async () => {
    mockApiPut.mockResolvedValueOnce(firstRound).mockResolvedValueOnce(secondRound);

    const outcome = await updateGroupMemberships('group-coruna', changes);

    expect(outcome).toStrictEqual(buildMembershipResponse({
      added: ['kw-1', 'kw-2'],
      removed: ['kw-9', 'kw-8'],
      keywords: [buildKeyword({ id: 'kw-1' }), buildKeyword({ id: 'kw-2' })],
    }));
  });

  it('stops after ten requests with what was applied and an incomplete-write reason', async () => {
    mockApiPut.mockResolvedValueOnce(firstRound).mockResolvedValue(buildMembershipResponse({
      pending: ['kw-2'],
      truncated: true,
    }));

    const failure = await updateGroupMemberships('group-coruna', changes).catch((error: unknown) => error);

    expect(mockApiPut).toHaveBeenCalledTimes(MAX_WRITE_ROUNDS);
    expect(failure).toBeInstanceOf(PartialMembershipUpdateError);
    expect(failure).toMatchObject({
      appliedChanges: 3,
      totalChanges: 4,
      failure: new IncompleteWriteError(
        '1 keyword membership change was still pending after 10 attempts. Apply the change again to finish.',
        1
      ),
    });
  });
});
