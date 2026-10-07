import {
  describe, expect, it, vi
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
  NARRATIVE_POLL_ATTEMPTS, NARRATIVE_POLL_INTERVAL_MS, useNarrativeRegeneration
} from './useNarrativeRegeneration';
import {
  buildInsightsWithNarrative, buildRegeneratedNarrative, mockApiGet, mockApiPost, stubRegenerateAndPoll
} from './useNarrativeRegeneration-fixtures';

vi.mock('../api/client', () => import('./useNarrativeRegeneration-fixtures'));

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

describe('useNarrativeRegeneration', () => {
  runEachTestWithFakeTimers();

  it('asks the API to regenerate the group narrative', async () => {
    await renderRegenerating(buildRegeneratedNarrative());

    expect(mockApiPost).toHaveBeenCalledWith('/reports/insights/regenerate', { group_id: 'group-coruna' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('polls the insights of the same scope and period', async () => {
    await renderRegenerating(buildRegeneratedNarrative());
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS);

    expect(mockApiGet).toHaveBeenCalledWith('/reports/insights', expect.objectContaining({
      params: {
        group_id: 'group-coruna',
        days: '90',
      },
    }));
  });

  it('is regenerating until the new narrative is stored', async () => {
    const { result } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS * 3);

    expect(result.current.phase).toBe('regenerating');
    expect(result.current.narrative).toBeNull();
  });

  it('returns the new narrative once its generated_at changes', async () => {
    const { result } = await renderRegenerating(buildNarrative());
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS);

    mockApiGet.mockResolvedValue(buildInsightsWithNarrative(buildRegeneratedNarrative()));
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS);

    expect(result.current.narrative).toStrictEqual(buildRegeneratedNarrative());
    expect(result.current.phase).toBe('idle');
  });

  it('keeps polling through a failed read', async () => {
    mockApiGet.mockRejectedValueOnce(new TestError('network down'));
    const { result } = await renderRegenerating(buildRegeneratedNarrative());
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS * 2);

    expect(result.current.narrative).toStrictEqual(buildRegeneratedNarrative());
  });

  it('times out when no new narrative arrives within the window', async () => {
    const { result } = await renderRegenerating(null);
    await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS * NARRATIVE_POLL_ATTEMPTS);

    expect(result.current.phase).toBe('timed_out');
    expect(mockApiGet).toHaveBeenCalledTimes(NARRATIVE_POLL_ATTEMPTS);
  });

  it('fails without polling when the regenerate request is refused', async () => {
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

  it('calls clearTimeout when unmounted with a poll pending', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await renderRegenerating(buildNarrative());

    const callsBefore = clearTimeoutSpy.mock.calls.length;
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(callsBefore + 1);
  });
});
