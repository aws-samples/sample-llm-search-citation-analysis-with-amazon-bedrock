import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import type { ReportScope } from '../types';
import type { InsightsNarrative } from '../types/domain/insightsNarrative';
import { buildNarrative } from '../types/domain/insightsNarrative-fixtures';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../test/fakeTime';
import { TestError } from '../test/testError';
import {
  NARRATIVE_WAIT_LIMIT_MS, useNarrativeRegeneration
} from './useNarrativeRegeneration';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';
import {
  buildInsightsWithNarrative, buildRegeneratedNarrative, mockApiGet, mockApiPost, stubRegenerateAndPoll
} from './useNarrativeRegeneration-fixtures';

vi.mock('../api/client', () => import('./useNarrativeRegeneration-fixtures'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

const GROUP_SCOPE: ReportScope = {
  kind: 'group',
  groupId: 'group-coruna',
};
const STORED_AT = buildNarrative().generated_at;

function renderRegeneration(scope: ReportScope = GROUP_SCOPE) {
  return renderHook(() => useNarrativeRegeneration(scope, 90, STORED_AT));
}

/** The hook with a regenerate request accepted and every poll answering `polled`. */
async function renderRegenerating(polled: InsightsNarrative | null) {
  stubRegenerateAndPoll(polled);
  const rendered = renderRegeneration();
  await act(async () => {
    void rendered.result.current.regenerate();
  });
  return rendered;
}

const WRITTEN = {
  type: 'narrative.finished',
  group_id: 'group-coruna',
  status: 'generated' 
};

describe('useNarrativeRegeneration', () => {
  runEachTestWithFakeTimers();

  afterEach(() => {
    resetLiveEvents();
  });

  it('asks the API to regenerate the group narrative', async () => {
    await renderRegenerating(buildRegeneratedNarrative());

    expect(mockApiPost).toHaveBeenCalledWith('/reports/insights/regenerate', { group_id: 'group-coruna' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('reads the insights of the same scope and period once it listens, to catch up', async () => {
    await renderRegenerating(buildRegeneratedNarrative());
    await advanceFakeTime(0);

    expect(mockApiGet).toHaveBeenCalledWith('/reports/insights', expect.objectContaining({
      params: {
        group_id: 'group-coruna',
        days: '90',
      },
    }));
  });

  it('is regenerating until the new narrative is stored, and reads nothing on a timer', async () => {
    const { result } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(NARRATIVE_WAIT_LIMIT_MS - 1);

    expect([result.current.phase, result.current.narrative, mockApiGet.mock.calls.length]).toStrictEqual(['regenerating', null, 1]);
  });

  it('returns the new narrative when the group’s narrative event arrives', async () => {
    const { result } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(0);

    mockApiGet.mockResolvedValue(buildInsightsWithNarrative(buildRegeneratedNarrative()));
    await emitLive('insights', WRITTEN);

    expect(result.current.narrative).toStrictEqual(buildRegeneratedNarrative());
    expect(result.current.phase).toBe('idle');
  });

  it.each([
    ['another group', { group_id: 'group-lugo' }],
    ['another market', { market_id: 'es-CL' }],
  ])('ignores the narrative event of %s', async (_case, fields) => {
    await renderRegenerating(buildNarrative());
    await advanceFakeTime(0);

    await emitLive('insights', {
      ...WRITTEN,
      ...fields 
    });

    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'skipped'])('fails when the worker %s the narrative', async (status) => {
    const { result } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(0);

    await emitLive('insights', {
      ...WRITTEN,
      status 
    });

    expect(result.current.phase).toBe('failed');
  });

  it('keeps waiting through a failed read', async () => {
    mockApiGet.mockRejectedValueOnce(new TestError('network down'));
    const { result } = await renderRegenerating(buildRegeneratedNarrative());
    await advanceFakeTime(0);
    await emitLive('insights', WRITTEN);

    expect(result.current.narrative).toStrictEqual(buildRegeneratedNarrative());
  });

  it('times out when no new narrative arrives within the window', async () => {
    const { result } = await renderRegenerating(null);
    await advanceFakeTime(NARRATIVE_WAIT_LIMIT_MS);

    expect([result.current.phase, liveSubscriberCount('insights')]).toStrictEqual(['timed_out', 0]);
  });

  it('fails without reading when the regenerate request is refused', async () => {
    mockApiPost.mockRejectedValue(new TestError('HTTP 403: Forbidden'));
    const { result } = renderRegeneration();

    await act(async () => {
      await result.current.regenerate();
    });

    expect(result.current.phase).toBe('failed');
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('requests nothing for a scope that is not a keyword group', async () => {
    const { result } = renderRegeneration({ kind: 'all' });

    await act(async () => {
      await result.current.regenerate();
    });

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('stops listening when unmounted while it waits', async () => {
    const { unmount } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(0);

    unmount();

    expect(liveSubscriberCount('insights')).toBe(0);
  });
});
