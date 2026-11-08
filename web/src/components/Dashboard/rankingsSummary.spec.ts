import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchRankTrackers, fetchRankTrend
} from '../../api/seoRankTracking';
import {
  buildRankTracker, buildRankTrend, buildTrackerList, buildTrendPoint
} from '../../api/seoRankTracking-fixtures';
import {
  loadRankingsSummary, newestTrendPoint, summarizeRankings
} from './rankingsSummary';

vi.mock('../../api/seoRankTracking');

const OLD_POINT = buildTrendPoint({
  run_id: 'run-old',
  started_at: '2026-10-01T08:00:00Z',
  top3: 1,
});
const NEW_DESKTOP = buildTrendPoint({
  run_id: 'run-new',
  started_at: '2026-10-08T08:00:00Z',
  device: 'desktop',
  top3: 4,
});
const NEW_MOBILE = buildTrendPoint({
  run_id: 'run-new',
  started_at: '2026-10-08T08:00:00Z',
  device: 'mobile',
  top3: 2,
});

describe('newestTrendPoint', () => {
  it('returns the desktop point of the newest check when both devices were checked', () => {
    expect(newestTrendPoint([OLD_POINT, NEW_MOBILE, NEW_DESKTOP])).toStrictEqual(NEW_DESKTOP);
  });

  it('returns null when the tracker has no check in the window', () => {
    expect(newestTrendPoint([])).toBeNull();
  });
});

describe('summarizeRankings', () => {
  it('sums top 3, top 10 and keywords over the checked trackers', () => {
    const first = buildTrendPoint({
      total: 10,
      top3: 2,
      top4_10: 3,
    });
    const second = buildTrendPoint({
      total: 5,
      top3: 1,
      top4_10: 0,
    });

    expect(summarizeRankings([first, second, null])).toStrictEqual({
      trackers: 3,
      checkedTrackers: 2,
      keywords: 15,
      top3: 3,
      top10: 6,
    });
  });
});

describe('loadRankingsSummary', () => {
  beforeEach(() => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({
      trackers: [
        buildRankTracker({
          tracker_id: 'rt-chile',
          market_id: 'cl-es',
        }),
        buildRankTracker({
          tracker_id: 'rt-brazil',
          market_id: 'br-pt',
        }),
        buildRankTracker({
          tracker_id: 'rt-archived',
          market_id: 'cl-es',
          is_active: false,
        }),
      ],
    }));
    vi.mocked(fetchRankTrend).mockResolvedValue(buildRankTrend());
  });

  it('reads the trend of the active trackers of the selected market only', async () => {
    await loadRankingsSummary('cl-es');

    expect(vi.mocked(fetchRankTrend).mock.calls.map(([trackerId]) => trackerId)).toStrictEqual(['rt-chile']);
  });

  it('reads the trend of every active tracker when every market is combined', async () => {
    await loadRankingsSummary(null);

    expect(vi.mocked(fetchRankTrend).mock.calls.map(([trackerId]) => trackerId)).toStrictEqual(['rt-chile', 'rt-brazil']);
  });
});
