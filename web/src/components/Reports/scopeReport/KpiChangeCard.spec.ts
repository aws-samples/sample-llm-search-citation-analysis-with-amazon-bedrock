import {
  describe, it, expect
} from 'vitest';
import { latestRunsSubtitle } from './KpiChangeCard';
import { buildVisibility } from '../layout/reportPayload-fixtures';
import {
  buildKpis, RUN_2
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import { formatDate } from '../../../formatting/dateFormatter';

const NEWEST = `(newest ${formatDate(RUN_2)})`;

describe('latestRunsSubtitle', () => {
  it.each([
    ['names the newest run and one keyword', `Each keyword's latest run ${NEWEST}: 20 AI answers over 1 keyword.`, buildVisibility()],
    ['leaves the newest run out without a timestamp', 'Each keyword\'s latest run: 20 AI answers over 1 keyword.', buildVisibility({ timestamp: null })],
    ['counts several keywords in the plural', `Each keyword's latest run ${NEWEST}: 20 AI answers over 3 keywords.`, buildVisibility({ keywords_with_data: 3 })],
    [
      'counts zero answers when the answer count is unknown',
      `Each keyword's latest run ${NEWEST}: 0 AI answers over 1 keyword.`,
      buildVisibility({ kpis: buildKpis({ answers: null }) }),
    ],
  ])('%s', (_outcome, subtitle, visibility) => {
    expect(latestRunsSubtitle(visibility)).toBe(subtitle);
  });
});
