import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  apiGet, apiPost
} from '../api/client';
import { reportScopeParams } from '../components/ui/reportScope';
import type { ReportScope } from '../types';
import type { InsightsNarrative } from '../types/domain/insightsNarrative';
import { decodeInsightsNarrative } from '../types/domain/insightsNarrativeDecoders';
import { isRecord } from '../types/domain/keywordDecoders';

/**
 * Polling schedule after a regenerate request: every 5 s for two minutes,
 * which outlasts the worker's 120 s timeout plus its asynchronous start.
 */
export const NARRATIVE_POLL_INTERVAL_MS = 5000;
export const NARRATIVE_POLL_ATTEMPTS = 24;

export const REGENERATE_FAILED_MESSAGE = 'The narrative could not be regenerated. Try again later.';
export const REGENERATE_TIMEOUT_MESSAGE = 'The new narrative is taking longer than expected. Reload the report in a minute to see it.';

/** Where a regenerate request stands: none, waiting for the new narrative, or given up. */
export type RegenerationPhase = 'idle' | 'regenerating' | 'failed' | 'timed_out';

/** Resolves after `ms`, or at once when `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** The stored narrative `GET /reports/insights` answers for the scope; `null` when it has none or the read fails. */
async function readNarrative(scope: ReportScope, days: number, signal: AbortSignal): Promise<InsightsNarrative | null> {
  try {
    const response = await apiGet<unknown>('/reports/insights', {
      params: {
        ...reportScopeParams(scope),
        days: String(days),
      },
      signal,
    });
    return isRecord(response) ? decodeInsightsNarrative(response.narrative) : null;
  } catch {
    // A failed read is retried at the next tick; only the window running out stops the poll.
    return null;
  }
}

/**
 * The newly written narrative, polled until its `generated_at` differs from
 * `previous`; `null` when the window ran out or the poll was aborted.
 */
async function pollNewNarrative(
  scope: ReportScope,
  days: number,
  previous: string | null,
  signal: AbortSignal,
  attempt = 0
): Promise<InsightsNarrative | null> {
  if (attempt >= NARRATIVE_POLL_ATTEMPTS || signal.aborted) return null;
  await wait(NARRATIVE_POLL_INTERVAL_MS, signal);
  const narrative = signal.aborted ? null : await readNarrative(scope, days, signal);
  if (narrative !== null && narrative.generated_at !== previous) return narrative;
  return pollNewNarrative(scope, days, previous, signal, attempt + 1);
}

/**
 * Regenerates a keyword group's narrative (`POST /reports/insights/regenerate`,
 * Admin only) and polls `GET /reports/insights` until the stored narrative's
 * `generated_at` changes from `generatedAt`, the one on screen. `narrative`
 * is the new narrative once it is in, `phase` where the request stands.
 * Unmounting stops the poll.
 */
export function useNarrativeRegeneration(scope: ReportScope, days: number, generatedAt: string | null) {
  const [phase, setPhase] = useState<RegenerationPhase>('idle');
  const [narrative, setNarrative] = useState<InsightsNarrative | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const regenerate = useCallback(async () => {
    if (scope.kind !== 'group') return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase('regenerating');
    try {
      await apiPost('/reports/insights/regenerate', { group_id: scope.groupId }, { signal: current.signal });
    } catch {
      if (!current.signal.aborted) setPhase('failed');
      return;
    }
    const fresh = await pollNewNarrative(scope, days, narrative?.generated_at ?? generatedAt, current.signal);
    if (current.signal.aborted) return;
    if (fresh !== null) setNarrative(fresh);
    setPhase(fresh === null ? 'timed_out' : 'idle');
  }, [scope, days, narrative, generatedAt]);

  return {
    phase,
    narrative,
    regenerate,
  };
}
