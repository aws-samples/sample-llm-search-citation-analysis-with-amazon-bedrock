import {
  describe, expect, it, vi
} from 'vitest';
import { useRecommendations } from './useRecommendations';
import {
  act, renderHook
} from '@testing-library/react';
import { scopedFixture } from '../test/scopedFixtures';
import {
  answerFetchesInOrder, setupFakeTimersAndFetch, startThenAdvance
} from '../test/scopedTestKit';

vi.mock('../api/recommendations', () => ({ saveRecommendationStatus: vi.fn() }));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

import { saveRecommendationStatus } from '../api/recommendations';

const complete = scopedFixture('recommendations', 'complete');
const computing = scopedFixture('recommendations', 'computing');

/** Renders the hook, answers its fetches with `answers` and lets `ms` pass after the first fetch. */
async function renderPolledRecommendations(ms: number, ...answers: ReadonlyArray<readonly [unknown, number]>) {
  answerFetchesInOrder(...answers);
  const { result } = renderHook(() => useRecommendations());
  await startThenAdvance(() => result.current.fetchRecommendations(), ms);
  return result;
}

describe('useRecommendations on a 2.45.0 scope', () => {
  setupFakeTimersAndFetch();

  it('holds the view job while it waits for a 202 answer’s job', async () => {
    const result = await renderPolledRecommendations(0, [computing, 202], [computing, 202]);

    expect(result.current.computing).toStrictEqual(computing);
  });

  it('stores the answer the view job computed', async () => {
    const result = await renderPolledRecommendations(2_000, [computing, 202], [complete, 200]);

    expect([result.current.data, result.current.computing]).toStrictEqual([complete, null]);
  });

  it('keeps the request the answer came from for the next pages', async () => {
    const result = await renderPolledRecommendations(0, [complete, 200]);

    expect(result.current.request?.params?.get('scope')).toBe('all');
  });

  it('remembers a saved status by recommendation id for rows of later pages', async () => {
    vi.mocked(saveRecommendationStatus).mockResolvedValue('done');
    const { result } = renderHook(() => useRecommendations());

    await act(async () => {
      await result.current.updateStatus({
        id: 'rec-on-page-3',
        type: 'ranking',
        priority: 'low',
        title: 'Low rankings',
        description: '',
        action: '',
        impact: '',
      }, 'done');
    });

    expect(result.current.savedStatuses).toStrictEqual({ 'rec-on-page-3': 'done' });
  });
});
