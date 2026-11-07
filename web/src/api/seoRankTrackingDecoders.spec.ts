import {
  describe, expect, it
} from 'vitest';
import {
  buildRankCell, buildRankEstimate, buildRankResults, buildRankRun, buildRankTracker, buildResultRow, buildTrackerList
} from './seoRankTracking-fixtures';
import {
  isRankEstimate, isRankResults, isRankRun, isRankTracker, isRankTrackerList
} from './seoRankTrackingDecoders';
import { withoutField } from './seo-fixtures';

describe('rank tracking decoders', () => {
  it('accepts a complete run', () => {
    expect(isRankRun(buildRankRun())).toBe(true);
  });

  it('refuses a run with an unknown status', () => {
    expect(isRankRun({
      ...buildRankRun(),
      status: 'paused' 
    })).toBe(false);
  });

  it('accepts a tracker that was never checked', () => {
    expect(isRankTracker(buildRankTracker({
      latest_run: null,
      last_checked_at: null,
      next_check_at: null 
    }))).toBe(true);
  });

  it('refuses a tracker without its schedule', () => {
    expect(isRankTracker(withoutField(buildRankTracker(), 'schedule'))).toBe(false);
  });

  it('refuses a list whose competitor domains are not lists', () => {
    expect(isRankTrackerList({
      ...buildTrackerList(),
      competitor_domains: { Acme: 'acme.example.org' } 
    })).toBe(false);
  });

  it('accepts results with a device that is not tracked', () => {
    expect(isRankResults(buildRankResults({
      devices: ['desktop'],
      rows: [buildResultRow({ mobile: null })] 
    }))).toBe(true);
  });

  it('refuses a result cell with an unknown status', () => {
    const rows = [buildResultRow({
      desktop: {
        ...buildRankCell(),
        status: 'lost' as 'found' 
      } 
    })];

    expect(isRankResults(buildRankResults({ rows }))).toBe(false);
  });

  it('refuses an estimate without its searches per check', () => {
    expect(isRankEstimate(withoutField(buildRankEstimate(), 'pairs'))).toBe(false);
  });
});
