import { useMemo } from 'react';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { useQueryPrompts } from '../../hooks/useQueryPrompts';
import {
  runTargetsFrom, type RunTargets
} from './runTargets';

export type RunTargetsState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
    readonly status: 'ready';
    readonly targets: RunTargets 
  };

/**
 * The AI engines and personas a run would use, read from the same
 * `GET /providers` and `GET /query-prompts` that Settings reads. When the
 * provider list cannot be read the state is `unavailable` (the providers hook
 * would otherwise stand in placeholder rows), and the page says so instead of
 * guessing a count.
 */
export function useRunTargets(): RunTargetsState {
  const {
    providers, loading: providersLoading, error
  } = useProviderConfig();
  const {
    prompts, loading: promptsLoading
  } = useQueryPrompts();
  return useMemo<RunTargetsState>(() => {
    if (providersLoading || promptsLoading) return { status: 'loading' };
    if (error !== null) return { status: 'unavailable' };
    return {
      status: 'ready',
      targets: runTargetsFrom(providers, prompts),
    };
  }, [providers, prompts, providersLoading, promptsLoading, error]);
}
