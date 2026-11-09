/**
 * The SEO channel's `seo-job.changed` event (`lambda/seo-jobs/seo-jobs.py`) for the specs of the hooks that follow
 * a running SEO job (`useSeoJobRefresh`), and the waits those specs share.
 */
import { expect } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { LiveEvent } from '../infrastructure/liveEvents/liveChannels';
import {
  emitLive, liveSubscriberCount
} from './liveEventsMock';

/** Tells the SEO channel that a step of the `feature` job `id` ran. */
export function emitSeoJobChanged(feature: string, id: string): Promise<void> {
  const event: LiveEvent = {
    type: 'seo-job.changed',
    feature,
    id
  };
  return emitLive('seo', event);
}

/** Waits until `read` (the job's status route) has been called `count` times. */
export async function waitForJobReads(read: (...args: never[]) => unknown, count: number): Promise<void> {
  await waitFor(() => {
    expect(read).toHaveBeenCalledTimes(count);
  });
}

/**
 * Tells the SEO channel that a step of the `feature` job `id` ran and waits until `status()` is `done`; how many
 * views still listen to the SEO channel then.
 */
export async function waitForDoneAfterSeoJobChanged(feature: string, id: string, status: () => string): Promise<number> {
  await emitSeoJobChanged(feature, id);
  await waitFor(() => {
    expect(status()).toBe('done');
  });
  return liveSubscriberCount('seo');
}
