import {
  useCallback, useRef, useState
} from 'react';
import type { ReportScope } from '../../types';
import {
  ALL_SCOPE, encodeReportScope
} from '../ui/reportScope';

export interface ScopeSelection {
  /** The scope the view covers: every keyword until the user picks another. */
  readonly scope: ReportScope;
  /** Switches to `next`; picking the current scope again does nothing. */
  readonly selectScope: (next: ReportScope) => void;
  /**
   * True from the moment a different scope is picked until its request
   * settles, so the view hides the previous scope's results instead of
   * showing them under the new scope's name.
   */
  readonly scopePending: boolean;
  /**
   * Call it from the effect that fires the selected scope's request, with
   * that request: it clears `scopePending` once the request settles, unless
   * another scope was picked meanwhile. Returns the effect's cleanup.
   */
  readonly trackScopeRequest: (request: unknown) => () => void;
}

/**
 * The scope selection of an insights view (Citation Gaps, Prompt Insights,
 * Action Center): the selected scope, how to change it, and whether the
 * results on screen still belong to an earlier scope.
 */
export function useScopeSelection(): ScopeSelection {
  const [scope, setScope] = useState<ReportScope>(ALL_SCOPE);
  const [scopePending, setScopePending] = useState(false);
  const selectionSequence = useRef(0);
  const scopeKey = encodeReportScope(scope);

  const selectScope = useCallback((next: ReportScope) => {
    if (encodeReportScope(next) === scopeKey) return;
    selectionSequence.current += 1;
    setScopePending(true);
    setScope(next);
  }, [scopeKey]);

  const trackScopeRequest = useCallback((request: unknown) => {
    const requestSequence = selectionSequence.current;
    const requestStatus = { active: true };
    void Promise.resolve(request).finally(() => {
      if (requestStatus.active && requestSequence > 0 && requestSequence === selectionSequence.current) {
        setScopePending(false);
      }
    });
    return () => {
      requestStatus.active = false;
    };
  }, []);

  return {
    scope,
    selectScope,
    scopePending,
    trackScopeRequest,
  };
}
