import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  apiGet, apiPost
} from '../api/client';
import { reportScopeParams } from '../components/ui/reportScope';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import type { ReportScope } from '../types';
import type { InsightsNarrative } from '../types/domain/insightsNarrative';
import { decodeInsightsNarrative } from '../types/domain/insightsNarrativeDecoders';
import { isRecord } from '../types/domain/keywordDecoders';
import {
  deploymentChannel, eventField, waitForLive, type LiveEvent
} from '../infrastructure/liveEvents';

/**
 * How long a regenerate request waits for its narrative: two minutes, which outlasts the worker's 120 s timeout
 * plus its asynchronous start.
 */
export const NARRATIVE_WAIT_LIMIT_MS = 120_000;

const INSIGHTS_CHANNEL = deploymentChannel('insights');

export const REGENERATE_FAILED_MESSAGE = 'The narrative could not be regenerated. Try again later.';
export const REGENERATE_TIMEOUT_MESSAGE = 'The new narrative is taking longer than expected. Reload the report in a minute to see it.';

/** Where a regenerate request stands: none, waiting for the new narrative, or given up. */
export type RegenerationPhase = 'idle' | 'regenerating' | 'failed' | 'timed_out';

/** The stored narrative `GET /reports/insights` answers for the scope; `null` when it has none or the read fails. */
async function readNarrative(scopeParams: Record<string, string>, days: number, signal: AbortSignal): Promise<InsightsNarrative | null> {
  try {
    const response = await apiGet<unknown>('/reports/insights', {
      params: {
        ...scopeParams,
        days: String(days),
      },
      signal,
    });
    return isRecord(response) ? decodeInsightsNarrative(response.narrative) : null;
  } catch {
    // A failed read is tried again on the next event or reconnect; only the window running out stops the wait.
    return null;
  }
}

/**
 * Whether `event` says the narrative of group `groupId` in market `marketId` (`null`: the global market, which
 * the event leaves unnamed) was written or given up on (`narrative.finished`, `lambda/report-insights/handler.py`).
 */
export function isNarrativeFinished(event: LiveEvent, groupId: string, marketId: string | null): boolean {
  return event.type === 'narrative.finished'
    && eventField(event, 'group_id') === groupId
    && (eventField(event, 'market_id') ?? null) === marketId;
}

interface NarrativeWait {
  readonly groupId: string;
  readonly marketId: string | null;
  readonly scopeParams: Record<string, string>;
  readonly days: number;
  readonly previous: string | null;
  readonly signal: AbortSignal;
}

/** How a regenerate request ended: the new narrative, or why there is none. */
type NarrativeOutcome =
  | {readonly narrative: InsightsNarrative}
  | { readonly phase: 'failed' | 'timed_out' | 'aborted' };

class NarrativeTimedOutError extends Error {
  constructor() {
    super(REGENERATE_TIMEOUT_MESSAGE);
    this.name = 'NarrativeTimedOutError';
  }
}

/**
 * Waits for the regenerated narrative (TENETS.md tenet 8): `GET /reports/insights` is read once when the insights
 * channel connects (and after every reconnect) and again when the group's `narrative.finished` event arrives,
 * until its `generated_at` differs from `previous`; an event saying the worker failed or skipped ends the wait.
 */
async function awaitNewNarrative(wait: NarrativeWait): Promise<NarrativeOutcome> {
  const ended = { status: '' };
  try {
    return await waitForLive<NarrativeOutcome>({
      channel: INSIGHTS_CHANNEL,
      matches: (event) => {
        if (!isNarrativeFinished(event, wait.groupId, wait.marketId)) return false;
        ended.status = eventField(event, 'status') ?? '';
        return true;
      },
      read: async () => {
        const narrative = await readNarrative(wait.scopeParams, wait.days, wait.signal);
        if (narrative !== null && narrative.generated_at !== wait.previous) return {
          settled: true,
          value: { narrative } 
        };
        const gaveUp = ended.status === 'failed' || ended.status === 'skipped';
        return gaveUp ? {
          settled: true,
          value: { phase: 'failed' } 
        } : { settled: false };
      },
      limitMs: NARRATIVE_WAIT_LIMIT_MS,
      timedOut: () => new NarrativeTimedOutError(),
      signal: wait.signal,
      abortedValue: () => ({ phase: 'aborted' }),
    });
  } catch {
    return { phase: 'timed_out' };
  }
}

/** The phase a wait's outcome leaves the request in; `null` when it was superseded or unmounted. */
function settledPhase(outcome: NarrativeOutcome): RegenerationPhase | null {
  if ('narrative' in outcome) return 'idle';
  return outcome.phase === 'aborted' ? null : outcome.phase;
}

/**
 * Regenerates a keyword group's narrative (`POST /reports/insights/regenerate`,
 * Admin only) in the header's market and waits (`awaitNewNarrative`) until
 * the stored narrative's `generated_at` changes from `generatedAt`, the one
 * on screen. `narrative` is the new narrative once it is in, `phase` where
 * the request stands. Unmounting stops the wait.
 */
export function useNarrativeRegeneration(scope: ReportScope, days: number, generatedAt: string | null) {
  const [phase, setPhase] = useState<RegenerationPhase>('idle');
  const [narrative, setNarrative] = useState<InsightsNarrative | null>(null);
  const controller = useRef<AbortController | null>(null);
  const marketId = useSelectedMarketId();

  useEffect(() => () => controller.current?.abort(), []);

  const regenerate = useCallback(async () => {
    if (scope.kind !== 'group') return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase('regenerating');
    try {
      const body = marketId === null ? { group_id: scope.groupId } : {
        group_id: scope.groupId,
        market_id: marketId,
      };
      await apiPost('/reports/insights/regenerate', body, { signal: current.signal });
    } catch {
      if (!current.signal.aborted) setPhase('failed');
      return;
    }
    const outcome = await awaitNewNarrative({
      groupId: scope.groupId,
      marketId,
      scopeParams: reportScopeParams(scope, marketId),
      days,
      previous: narrative?.generated_at ?? generatedAt,
      signal: current.signal,
    });
    const settled = settledPhase(outcome);
    if (current.signal.aborted || settled === null) return;
    if ('narrative' in outcome) setNarrative(outcome.narrative);
    setPhase(settled);
  }, [scope, marketId, days, narrative, generatedAt]);

  return {
    phase,
    narrative,
    regenerate,
  };
}
