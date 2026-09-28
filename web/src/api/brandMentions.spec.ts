import {
  describe, expect, it, vi
} from 'vitest';
import {
  fetchBrandMentionsAtRun, InvalidBrandMentionsResponseError
} from './brandMentions';
import { mockApiGet } from './clientMock-fixtures';
import { BRAND_MENTIONS_AT_RUN } from '../components/Reports/BrandVisibilityReport/groupKpiExport-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const HOTEL_GROUP = {
  kind: 'group',
  groupId: 'hotel-sol' 
} as const;

describe('fetchBrandMentionsAtRun', () => {
  it('reads the scope at the exact run', async () => {
    mockApiGet.mockResolvedValue(BRAND_MENTIONS_AT_RUN);

    await fetchBrandMentionsAtRun(HOTEL_GROUP, '2026-09-08T06:00:00.000000Z');

    expect(mockApiGet).toHaveBeenCalledWith('/brand-mentions', {
      params: {
        group_id: 'hotel-sol',
        timestamp: '2026-09-08T06:00:00.000000Z' 
      },
    });
  });

  it('returns the brand mentions the API answered', async () => {
    mockApiGet.mockResolvedValue(BRAND_MENTIONS_AT_RUN);

    await expect(fetchBrandMentionsAtRun(HOTEL_GROUP, 'ts')).resolves.toStrictEqual(BRAND_MENTIONS_AT_RUN);
  });

  it('refuses an answer that is not brand mentions', async () => {
    mockApiGet.mockResolvedValue({ aggregated: {} });

    await expect(fetchBrandMentionsAtRun(HOTEL_GROUP, 'ts')).rejects.toThrow(InvalidBrandMentionsResponseError);
    await expect(fetchBrandMentionsAtRun(HOTEL_GROUP, 'ts')).rejects.toThrow('Brand mentions API returned an invalid response');
  });

  it('names its error for the logs', () => {
    expect(new InvalidBrandMentionsResponseError().name).toBe('InvalidBrandMentionsResponseError');
  });
});
