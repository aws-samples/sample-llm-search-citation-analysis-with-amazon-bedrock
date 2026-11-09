import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import { useLiveRefresh } from './useLiveRefresh';

const SEO_CHANNEL = deploymentChannel('seo');

/** The `feature` a `seo-job.changed` event names (`lambda/seo-jobs/seo-jobs.py`). */
type SeoJobFeature = 'audit' | 'lighthouse' | 'local' | 'rank';

/** Whether `event` says a step of the `feature` job `id` ran (`seo-job.changed`). */
function isSeoJobEvent(event: LiveEvent, feature: SeoJobFeature, id: string): boolean {
  return eventField(event, 'feature') === feature && eventField(event, 'id') === id;
}

/**
 * While `id` names a running `feature` job, runs `read(id)` once on every (re)connect of the SEO channel (the
 * catch-up read) and again whenever a step of that job ran (TENETS.md tenet 8). `id` `null` listens to nothing.
 */
export function useSeoJobRefresh(
  feature: SeoJobFeature,
  id: string | null,
  read: (id: string) => Promise<unknown>
): void {
  useLiveRefresh(
    id === null ? null : SEO_CHANNEL,
    () => (id === null ? Promise.resolve() : read(id)),
    (event) => id !== null && isSeoJobEvent(event, feature, id)
  );
}
