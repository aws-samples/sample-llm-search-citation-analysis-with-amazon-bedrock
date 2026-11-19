import {
  fireEvent, screen
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  DONE_JOB, FAILED_JOB, RUNNING_JOB, buildReextractEstimate
} from '../../../api/reextract-fixtures';
import { emitLive } from '../../../test/liveEventsMock';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import {
  clickEstimate, confirmStart, jobPanel, pickGroup, renderEstimated, renderReextractSection, sentBodies, setFromDate, settle, startButton
} from './ReextractSection-fixtures';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));

const ONLY_OUTDATED = 'Only answers stored under an older rule';

beforeEach(() => {
  mockAdminRole(true);
});

describe('ReextractSection visibility', () => {
  it('renders nothing and reads nothing for a non-admin', async () => {
    mockAdminRole(false);
    await renderReextractSection();

    expect(screen.queryByRole('heading', { name: 'Re-extract stored answers' })).not.toBeInTheDocument();
    expect(sentBodies('/reextract', 'GET')).toStrictEqual([]);
  });

  describe('for an admin', () => {
    beforeEach(async () => {
      await renderReextractSection();
    });

    it('lists the keyword groups unchecked', () => {
      expect(screen.getByRole('checkbox', { name: 'Example Hotels (45 keywords)' })).not.toBeChecked();
    });

    it('checks Only answers stored under an older rule by default', () => {
      expect(screen.getByRole('checkbox', { name: ONLY_OUTDATED })).toBeChecked();
    });

    it('disables Re-extract until an estimate is shown', () => {
      expect(startButton()).toBeDisabled();
    });
  });
});

describe('ReextractSection estimate', () => {
  it('shows the answers, keywords, Bedrock cost and the answers already current', async () => {
    await renderEstimated();

    expect(screen.getByText('1,210 answers in 85 keywords · about $3.42 of Bedrock · 183 already current')).toBeInTheDocument();
  });

  it('leaves out the already-current count when it is zero', async () => {
    await renderEstimated({ estimate: buildReextractEstimate({ answers_current: 0 }) });

    expect(screen.getByText('1,210 answers in 85 keywords · about $3.42 of Bedrock')).toBeInTheDocument();
  });

  it('says the count is a lower bound when the estimate was truncated', async () => {
    await renderEstimated({ estimate: buildReextractEstimate({ truncated: true }) });

    expect(screen.getByText(/there are at least this many answers/)).toBeInTheDocument();
  });

  it('posts the chosen groups, dates and rule filter to the estimate route', async () => {
    await renderReextractSection();
    pickGroup('Costamar');
    setFromDate('2026-01-01');
    await clickEstimate();

    expect(sentBodies('/reextract/estimate')).toStrictEqual([{
      group_ids: ['group-costamar'],
      since: '2026-01-01',
      until: null,
      only_outdated: true,
    }]);
  });
});

describe('ReextractSection start', () => {
  it('names the estimated answers on an enabled Re-extract button once estimated', async () => {
    await renderEstimated();

    expect(startButton()).toHaveAccessibleName('Re-extract 1,210 answers');
    expect(startButton()).toBeEnabled();
  });

  it('disables Re-extract again after a filter change', async () => {
    await renderEstimated();
    fireEvent.click(screen.getByRole('checkbox', { name: ONLY_OUTDATED }));

    expect(startButton()).toBeDisabled();
  });

  it('disables Re-extract when the estimate found nothing to do', async () => {
    await renderEstimated({ estimate: buildReextractEstimate({ answers: 0 }) });

    expect(startButton()).toBeDisabled();
  });

  it('disables Re-extract while a job runs', async () => {
    await renderEstimated({ job: RUNNING_JOB });

    expect(startButton()).toBeDisabled();
  });

  it('posts the estimated filters once the dialog is confirmed', async () => {
    await renderReextractSection({
      start: {
        status: 202,
        body: { job: RUNNING_JOB },
      } 
    });
    pickGroup('Costamar');
    await clickEstimate();
    await confirmStart();

    expect(sentBodies('/reextract')).toStrictEqual([{
      group_ids: ['group-costamar'],
      since: null,
      until: null,
      only_outdated: true,
    }]);
  });

  it('shows the server message and the running job when one is already running', async () => {
    await renderEstimated({
      start: {
        status: 409,
        body: {
          error: 'A re-extract is already running',
          job: RUNNING_JOB,
        },
      } 
    });
    await confirmStart();

    expect(screen.getByRole('alert')).toHaveTextContent('A re-extract is already running');
    expect(jobPanel()).toHaveTextContent('400 of 1,210 answers · 30 of 85 keywords · 2 failed');
  });
});

describe('ReextractSection job panel', () => {
  it('shows the progress of a running job', async () => {
    await renderReextractSection({ job: RUNNING_JOB });

    expect(jobPanel()).toHaveTextContent('Re-extracting');
    expect(jobPanel()).toHaveTextContent('400 of 1,210 answers · 30 of 85 keywords · 2 failed');
  });

  it('posts to the stop route of the running job and shows it stopping', async () => {
    await renderReextractSection({
      job: RUNNING_JOB,
      stop: {
        job: {
          ...RUNNING_JOB,
          status: 'stopping',
        } 
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settle();

    expect(sentBodies('/reextract/rx-1a2b/stop')).toStrictEqual([{}]);
    expect(jobPanel()).toHaveTextContent('Stopping');
  });

  it('shows a failed job with its error and finish time', async () => {
    await renderReextractSection({ job: FAILED_JOB });

    expect(jobPanel()).toHaveTextContent('Failed');
    expect(jobPanel()).toHaveTextContent('Bedrock refused the request');
    expect(jobPanel()).toHaveTextContent(/Finished \S/);
  });

  it('shows a done job with the KPI rebuild and no Stop button', async () => {
    await renderReextractSection({ job: DONE_JOB });

    expect(jobPanel()).toHaveTextContent('Done');
    expect(jobPanel()).toHaveTextContent('The KPIs are being rebuilt from the new results.');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('reads the job again when a live reextract message arrives', async () => {
    const api = await renderReextractSection();
    api.job = DONE_JOB;
    await emitLive('reextract', {
      type: 'reextract.changed',
      job_id: 'rx-1a2b',
      status: 'done',
    });
    await settle();

    expect(sentBodies('/reextract', 'GET')).toHaveLength(2);
    expect(jobPanel()).toHaveTextContent('Done');
  });
});
