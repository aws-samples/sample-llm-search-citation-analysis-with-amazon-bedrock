import {
  act, renderHook
} from '@testing-library/react';
import type { GridJobRequest } from '../types/api/seoLocal';
import { useLocalSeoJob } from './useLocalSeoJob';

const GRID: GridJobRequest = {
  kind: 'grid',
  keyword: 'coffee',
  grid_size: 3,
  spacing_km: 2 
};

/** The hook after one grid start has settled. */
export async function renderStartedJob() {
  const hook = renderHook(() => useLocalSeoJob());
  await act(async () => { await hook.result.current.start(GRID); });
  return hook;
}
