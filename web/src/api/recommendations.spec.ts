import {
  describe, expect, it, vi
} from 'vitest';
import {
  InvalidRecommendationStatusResponseError, saveRecommendationStatus
} from './recommendations';
import { mockApiPost } from './clientMock-fixtures';
import { trackedRecommendation } from '../hooks/useRecommendations-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const STORED_DONE = {
  recommendation_id: 'rec-002',
  status: 'done',
  updated_at: '2026-10-04T09:00:00Z',
};

describe('saveRecommendationStatus', () => {
  it('posts the status with the notes the recommendation already carries, so the stored row keeps them', async () => {
    mockApiPost.mockResolvedValue(STORED_DONE);

    await saveRecommendationStatus(trackedRecommendation(1), 'done');

    expect(mockApiPost).toHaveBeenCalledWith(
      '/recommendations/rec-002/status',
      {
        status: 'done',
        notes: 'Owner: brand team',
        related_keyword: undefined,
        related_content_id: undefined,
      },
      { allowStructured4xx: true }
    );
  });

  it('encodes the id into the path', async () => {
    mockApiPost.mockResolvedValue({
      ...STORED_DONE,
      recommendation_id: 'a/b',
    });

    await saveRecommendationStatus({
      ...trackedRecommendation(1),
      id: 'a/b',
    }, 'done');

    expect(mockApiPost.mock.calls[0]?.[0]).toBe('/recommendations/a%2Fb/status');
  });

  it('returns the status the API stored', async () => {
    mockApiPost.mockResolvedValue(STORED_DONE);

    await expect(saveRecommendationStatus(trackedRecommendation(1), 'done')).resolves.toBe('done');
  });

  it.each([
    ['an unknown status', {
      ...STORED_DONE,
      status: 'archived',
    }],
    ['another recommendation', {
      ...STORED_DONE,
      recommendation_id: 'rec-001',
    }],
    ['no object', null],
  ])('rejects with InvalidRecommendationStatusResponseError when the API answers %s', async (_case, payload) => {
    mockApiPost.mockResolvedValue(payload);

    await expect(saveRecommendationStatus(trackedRecommendation(1), 'done'))
      .rejects.toThrow(InvalidRecommendationStatusResponseError);
  });
});
