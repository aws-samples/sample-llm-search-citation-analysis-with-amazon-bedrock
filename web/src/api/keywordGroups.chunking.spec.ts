import {
  describe, expect, it, vi
} from 'vitest';
import {
  MAX_MEMBERSHIP_CHANGES_PER_REQUEST,
  PartialMembershipUpdateError,
  updateGroupMemberships,
} from './keywordGroups';
import {
  buildKeyword, buildKeywordIds, buildMembershipResponse, sentPutBodies
} from './keywordGroups-fixtures';
import { mockApiPut } from './clientMock-fixtures';
import { ApiRequestError } from '../infrastructure';

vi.mock('./client', () => import('./clientMock-fixtures'));

const sixHundredIds = buildKeywordIds(600);
const firstChunkResponse = buildMembershipResponse({
  added: sixHundredIds.slice(0, 500),
  keywords: [buildKeyword({ id: 'kw-1' })],
});
const secondChunkResponse = buildMembershipResponse({
  added: sixHundredIds.slice(500, 599),
  missing: ['kw-600'],
  keywords: [buildKeyword({ id: 'kw-501' })],
});
const serverRejection = new ApiRequestError('HTTP 500', 500);

describe('updateGroupMemberships chunking', () => {
  it('mirrors the 500-id MAX_MEMBERSHIP_CHANGES cap of manage-keyword-groups.py', () => {
    expect(MAX_MEMBERSHIP_CHANGES_PER_REQUEST).toBe(500);
  });

  it('sends 600 additions as sequential requests of 500 and 100', async () => {
    mockApiPut.mockResolvedValueOnce(firstChunkResponse).mockResolvedValueOnce(secondChunkResponse);

    await updateGroupMemberships('group-coruna', { add: sixHundredIds });

    expect(sentPutBodies()).toStrictEqual([
      { add: sixHundredIds.slice(0, 500) },
      { add: sixHundredIds.slice(500) },
    ]);
  });

  it('pairs add and remove chunks by position when only the add list exceeds the cap', async () => {
    const addIds = buildKeywordIds(501, 'add');
    const removeIds = buildKeywordIds(2, 'remove');
    mockApiPut.mockResolvedValue(buildMembershipResponse());

    await updateGroupMemberships('group-coruna', {
      add: addIds,
      remove: removeIds,
    });

    expect(sentPutBodies()).toStrictEqual([
      {
        add: addIds.slice(0, 500),
        remove: removeIds,
      },
      {
        add: addIds.slice(500),
        remove: [],
      },
    ]);
  });

  it('merges the outcome of every chunk when all requests succeed', async () => {
    mockApiPut.mockResolvedValueOnce(firstChunkResponse).mockResolvedValueOnce(secondChunkResponse);

    const outcome = await updateGroupMemberships('group-coruna', { add: sixHundredIds });

    expect(outcome).toStrictEqual(buildMembershipResponse({
      added: sixHundredIds.slice(0, 599),
      missing: ['kw-600'],
      keywords: [buildKeyword({ id: 'kw-1' }), buildKeyword({ id: 'kw-501' })],
    }));
  });

  it('rejects with the request error itself when the first chunk fails', async () => {
    mockApiPut.mockRejectedValueOnce(serverRejection);

    await expect(updateGroupMemberships('group-coruna', { add: sixHundredIds })).rejects.toBe(serverRejection);
  });

  it('reports 500 of 600 applied with the first outcome when the second chunk fails', async () => {
    mockApiPut.mockResolvedValueOnce(firstChunkResponse).mockRejectedValueOnce(serverRejection);

    const failure = await updateGroupMemberships('group-coruna', { add: sixHundredIds }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PartialMembershipUpdateError);
    expect(failure).toMatchObject({
      appliedChanges: 500,
      totalChanges: 600,
      applied: firstChunkResponse,
      failure: serverRejection,
    });
  });

  it('stops sending chunks after the first failed request', async () => {
    mockApiPut.mockResolvedValueOnce(firstChunkResponse).mockRejectedValueOnce(serverRejection);

    await updateGroupMemberships('group-coruna', { add: buildKeywordIds(1100) }).catch(vi.fn());

    expect(mockApiPut).toHaveBeenCalledTimes(2);
  });
});
