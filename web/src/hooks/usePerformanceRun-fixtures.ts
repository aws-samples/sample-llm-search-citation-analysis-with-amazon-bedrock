import {
  act, renderHook
} from '@testing-library/react';
import { startLighthouse } from '../api/seoPerformance';
import { PAGE } from '../api/seoPerformance-fixtures';
import { usePerformanceRun } from './usePerformanceRun';

/** The hook after one single-page start has settled. */
export async function renderStartedRun() {
  const hook = renderHook(() => usePerformanceRun());
  await act(async () => {
    await hook.result.current.start(() => startLighthouse({
      url: PAGE,
      device: 'mobile'
    }));
  });
  return hook;
}
