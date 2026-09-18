import {
  describe, expect, it, vi 
} from 'vitest';
import {
  createKeywordGroup,
  deleteKeywordGroup,
  fetchKeywordGroups,
  InvalidKeywordGroupResponseError,
  mergeUpdatedKeywords,
  updateGroupMemberships,
  updateKeywordGroup,
} from './keywordGroups';
import {
  buildGroup,
  buildKeyword,
  groupsResponseFixture,
  membershipResponseFixture,
} from './keywordGroups-fixtures';
import {
  mockApiDelete, mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('keyword groups API', () => {
  describe('fetchKeywordGroups', () => {
    it('returns the groups array from a valid response', async () => {
      mockApiGet.mockResolvedValue(groupsResponseFixture);

      const groups = await fetchKeywordGroups();

      expect(groups).toStrictEqual(groupsResponseFixture.groups);
      expect(mockApiGet).toHaveBeenCalledWith('/keyword-groups', { signal: undefined });
    });

    it('throws InvalidKeywordGroupResponseError when the payload is malformed', async () => {
      mockApiGet.mockResolvedValue({ groups: [{ id: 42 }] });

      await expect(fetchKeywordGroups()).rejects.toThrow(InvalidKeywordGroupResponseError);
      await expect(fetchKeywordGroups()).rejects.toThrow('Keyword group API returned an invalid list');
    });
  });

  describe('createKeywordGroup', () => {
    it('posts the name and description and returns the created group', async () => {
      const created = buildGroup({ keyword_count: 0 });
      mockApiPost.mockResolvedValue(created);

      const result = await createKeywordGroup('Hotel Coruña', 'Galicia property');

      expect(result).toStrictEqual(created);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/keyword-groups',
        {
          name: 'Hotel Coruña',
          description: 'Galicia property' 
        },
        { allowStructured4xx: true }
      );
    });
  });

  describe('updateKeywordGroup', () => {
    it('puts the changes to the encoded group id', async () => {
      const renamed = buildGroup({ name: 'Renamed' });
      mockApiPut.mockResolvedValue(renamed);

      const result = await updateKeywordGroup('group/with slash', { name: 'Renamed' });

      expect(result).toStrictEqual(renamed);
      expect(mockApiPut).toHaveBeenCalledWith(
        '/keyword-groups/group%2Fwith%20slash',
        { name: 'Renamed' },
        { allowStructured4xx: true }
      );
    });
  });

  describe('deleteKeywordGroup', () => {
    it('deletes by encoded id', async () => {
      mockApiDelete.mockResolvedValue({ message: 'Keyword group deleted' });

      await deleteKeywordGroup('group-coruna');

      expect(mockApiDelete).toHaveBeenCalledWith('/keyword-groups/group-coruna', { allowStructured4xx: true });
    });
  });

  describe('updateGroupMemberships', () => {
    it('puts add/remove lists and returns the membership outcome', async () => {
      mockApiPut.mockResolvedValue(membershipResponseFixture);

      const result = await updateGroupMemberships('group-coruna', {
        add: ['kw-1', 'ghost'],
        remove: [] 
      });

      expect(result).toStrictEqual(membershipResponseFixture);
      expect(mockApiPut).toHaveBeenCalledWith(
        '/keyword-groups/group-coruna/keywords',
        {
          add: ['kw-1', 'ghost'],
          remove: [] 
        },
        { allowStructured4xx: true }
      );
    });

    it('throws InvalidKeywordGroupResponseError when keywords are missing from the payload', async () => {
      mockApiPut.mockResolvedValue({
        group_id: 'g',
        added: [],
        removed: [],
        missing: [] 
      });

      await expect(updateGroupMemberships('g', { add: ['x'] })).rejects.toThrow(InvalidKeywordGroupResponseError);
    });
  });

  describe('mergeUpdatedKeywords', () => {
    it('replaces matching ids and keeps the rest in their original order', () => {
      const original = [buildKeyword({ id: 'kw-1' }), buildKeyword({
        id: 'kw-2',
        keyword: 'second' 
      })];
      const updated = [buildKeyword({
        id: 'kw-2',
        keyword: 'second',
        group_ids: ['group-coruna'] 
      })];

      const merged = mergeUpdatedKeywords(original, updated);

      expect(merged).toStrictEqual([original[0], updated[0]]);
    });
  });
});
