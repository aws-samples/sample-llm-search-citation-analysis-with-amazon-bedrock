import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import { renderGroupKpiReport } from './GroupKpiReport-fixtures';
import {
  buildHistory, buildRun, RUN_1, RUN_2
} from './groupKpiHistory-fixtures';
import { answerFetchesInOrder } from '../../../test/scopedTestKit';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../../../hooks/useGroupKpiDetail', () => import('./groupKpiDetail-fixtures'));
vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

import {
  mockAuthenticatedFetch, stallAuthenticatedFetch
} from '../../../test/infrastructureMock';

const REQUEST = {
  path: '/reports/group-kpis',
  params: new URLSearchParams({ group_id: 'hotel-sol' }),
};
const cutHistory = buildHistory({
  runs: [buildRun({ timestamp: RUN_2 })],
  runs_truncated: true,
  runs_total: 2,
});
const everyRun = {
  runs: [buildRun({ timestamp: RUN_1 }), buildRun({ timestamp: RUN_2 })],
  runs_total: 2,
  next_token: null,
};

describe('GroupKpiReport runs of a cut summary', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('says the older runs are loading while view=runs reads them', () => {
    stallAuthenticatedFetch();
    renderGroupKpiReport({
      history: cutHistory,
      request: REQUEST,
    });

    expect(screen.getByText('Loading all 2 runs of the period…')).toBeInTheDocument();
  });

  it('drops the cut note once every run of the period is loaded', async () => {
    answerFetchesInOrder([everyRun, 200]);
    renderGroupKpiReport({
      history: cutHistory,
      request: REQUEST,
    });

    await screen.findByText(new Date(RUN_1).toLocaleString(), { exact: false });

    expect(screen.queryByText(/the report covers the runs from/u)).not.toBeInTheDocument();
  });

  it('reports older runs that could not be loaded', async () => {
    answerFetchesInOrder([{ error: 'Invalid view' }, 400]);
    renderGroupKpiReport({
      history: cutHistory,
      request: REQUEST,
    });

    expect(await screen.findByText('The older runs could not be loaded: Invalid request')).toBeInTheDocument();
  });
});
