import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AgentRunList, describeRunProgress
} from './AgentRunList';
import { buildAgentJob } from './agent-fixtures';

describe('describeRunProgress', () => {
  it('shows rounds, steps and candidates while a run is active', () => {
    const job = buildAgentJob({
      status: 'running',
      round: 1,
      steps_done: 2,
      steps_total: 3,
      keyword_count: 26,
    });

    expect(describeRunProgress(job)).toBe('round 1/2 · 2/3 steps · 26 candidates so far');
  });

  it('says planning before the first round is planned', () => {
    const job = buildAgentJob({
      status: 'pending',
      round: 0,
      steps_total: 0,
      keyword_count: 0,
    });

    expect(describeRunProgress(job)).toBe('planning · 0 candidates so far');
  });

  it('summarises rounds, candidates and the proposal once finished', () => {
    expect(describeRunProgress(buildAgentJob())).toBe('2 rounds · 41 candidates · 3 proposed');
  });
});

describe('AgentRunList', () => {
  const noop = vi.fn();

  it('offers a retry only for failed or partial runs', () => {
    render(
      <AgentRunList
        jobs={[buildAgentJob({ id: 'ok' }), buildAgentJob({
          id: 'bad',
          status: 'partial',
        })]}
        selectedId={null}
        loading={false}
        onSelect={noop}
        onRetry={noop}
        onDelete={noop}
      />
    );

    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('hides delete while a run is still active', () => {
    render(
      <AgentRunList
        jobs={[buildAgentJob({ status: 'running' })]}
        selectedId={null}
        loading={false}
        onSelect={noop}
        onRetry={noop}
        onDelete={noop}
      />
    );

    expect(screen.queryByRole('button', { name: /delete run/i })).toBeNull();
  });

  it('opens a run when its card is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <AgentRunList jobs={[buildAgentJob()]} selectedId={null} loading={false} onSelect={onSelect} onRetry={noop} onDelete={noop} />
    );

    await userEvent.click(screen.getByRole('button', {
      name: /Hotel Gran Marino/,
      pressed: false,
    }));

    expect(onSelect).toHaveBeenCalledWith('job-a');
  });

  it('tells the user how to start when there are no runs', () => {
    render(<AgentRunList jobs={[]} selectedId={null} loading={false} onSelect={noop} onRetry={noop} onDelete={noop} />);

    expect(screen.getByText(/No research runs yet/)).toBeInTheDocument();
  });
});
