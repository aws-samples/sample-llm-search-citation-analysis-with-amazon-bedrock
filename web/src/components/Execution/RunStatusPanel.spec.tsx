import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  describe, expect, it
} from 'vitest';
import type { Execution } from '../../types';
import { processExecutionData } from '../../formatting/executionProcessor';
import {
  buildEvent, buildExecution, buildKeywordProgress
} from '../../formatting/executionProcessorFixtures';
import { RunStatusPanel } from './RunStatusPanel';

const STARTED = '2026-01-23T10:00:00Z';
const STOPPED = '2026-01-23T10:12:03Z';

const KEYWORDS_STARTED = buildEvent({
  type: 'MapRunStarted',
  state_name: 'ProcessKeywords',
  message: 'Keyword processing started',
  timestamp: '2026-01-23T10:00:05Z',
});

function renderPanel(overrides: Partial<Execution>) {
  const execution = buildExecution({
    start_date: STARTED,
    ...overrides,
  });
  return render(
    <RunStatusPanel execution={execution} processedExecution={processExecutionData(execution)} />,
    { wrapper: MemoryRouter }
  );
}

const getTitleElement = () => screen.getByRole('heading', { level: 2 });

describe('RunStatusPanel', () => {
  it('shows a running run as the step under way with its keyword counts, live, and no links out', () => {
    renderPanel({
      events: [KEYWORDS_STARTED],
      progress: buildKeywordProgress(),
    });

    expect(getTitleElement()).toHaveTextContent('Run in progress');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Asking the AI engines and crawling the cited pages: 10 of 20 keywords done · 1 failed.'
    );
    expect(screen.getByText(/It keeps running if you leave this page/u)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a finished run with links to where the results are', () => {
    renderPanel({
      status: 'SUCCEEDED',
      stop_date: STOPPED,
      progress: buildKeywordProgress({
        keywords_succeeded: 20,
        keywords_failed: 0,
      }),
    });

    expect(getTitleElement()).toHaveTextContent('Run finished');
    expect(screen.getByText(/took 12m 3s/u)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The answers and citations are saved.');
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href')))
      .toStrictEqual(['/visibility', '/searches', '/raw-responses']);
  });

  it('says how many keywords failed in a run that finished', () => {
    renderPanel({
      status: 'SUCCEEDED',
      stop_date: STOPPED,
      progress: buildKeywordProgress({ keywords_failed: 3 }),
    });

    expect(getTitleElement()).toHaveTextContent('Run finished with failures');
    expect(screen.getByRole('status')).toHaveTextContent('3 keywords failed and have no answers from this run.');
  });

  it('shows a failed run with the failing step, the reason and what to do', () => {
    renderPanel({
      status: 'FAILED',
      stop_date: STOPPED,
      events: [
        buildEvent({
          type: 'MapRunFailed',
          state_name: 'ProcessKeywords',
          message: 'Keyword processing failed',
          error: 'States.ExceedToleratedFailureThreshold',
          timestamp: '2026-01-23T10:12:00Z',
        }),
        KEYWORDS_STARTED,
      ],
    });

    expect(getTitleElement()).toHaveTextContent('Run failed');
    expect(screen.getByText(/stopped after 12m 3s/u)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'It failed at the step “Ask AI engines and crawl sources”.Reason: States.ExceedToleratedFailureThreshold'
    );
    expect(screen.getByRole('link', { name: 'AI providers' })).toHaveAttribute('href', '/settings/providers');
  });

  it.each([
    ['TIMED_OUT', 'Run timed out', 'The run took longer than the time it is allowed.'],
    ['ABORTED', 'Run stopped', 'The run was stopped before it finished.'],
  ] as const)('names a %s run in words, not by its status code', (status, title, sentence) => {
    renderPanel({
      status,
      stop_date: STOPPED,
    });

    expect(getTitleElement()).toHaveTextContent(title);
    expect(screen.getByRole('status')).toHaveTextContent(sentence);
    // The status code is kept for support, behind the closed details.
    expect(screen.getByText(status)).not.toBeVisible();
  });

  it('keeps the run id and the activity log behind a disclosure', async () => {
    renderPanel({ events: [KEYWORDS_STARTED] });

    expect(screen.queryByText('test-execution')).not.toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Details and activity log (1 event)' }));

    expect(screen.getByText('test-execution')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Activity log' })).toHaveTextContent('Keyword processing started');
  });
  it('shows every step done once the run succeeded, even when the history missed a step exit', () => {
    renderPanel({
      status: 'SUCCEEDED',
      stop_date: STOPPED,
      events: [buildEvent({
        type: 'TaskStateEntered',
        state_name: 'ParseKeywords',
      })],
    });

    expect(screen.getAllByText('Done')).toHaveLength(3);
  });

  it('marks the step under way as failed when the run ends without finishing', () => {
    renderPanel({
      status: 'TIMED_OUT',
      stop_date: STOPPED,
      events: [KEYWORDS_STARTED],
    });

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });
});
