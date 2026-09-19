import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AgentRunList, describeRunProgress, runActionLabel
} from './AgentRunList';
import { buildAgentJob } from './agent-fixtures';
import type {
  KeywordResearchItem, ResearchStatus
} from '../../../types';

function renderRunList(jobs: KeywordResearchItem[]) {
  const handlers = {
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<AgentRunList jobs={jobs} loading={false} {...handlers} />);
  return handlers;
}

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

describe('runActionLabel', () => {
  it.each<[ResearchStatus, string]>([
    ['pending', 'View progress'],
    ['running', 'View progress'],
    ['processing', 'View progress'],
    ['completed', 'View results'],
    ['partial', 'View results'],
    ['failed', 'View details'],
  ])('offers "%s" → %s', (status, label) => {
    expect(runActionLabel(status)).toBe(label);
  });
});

describe('AgentRunList', () => {
  it('shows the status, seed, template, progress and proposal count of a run', () => {
    renderRunList([buildAgentJob()]);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Hotel Gran Marino')).toBeInTheDocument();
    expect(screen.getByText('· Hotels')).toBeInTheDocument();
    expect(screen.getByText(/^2 rounds · 41 candidates · 3 proposed · /)).toBeInTheDocument();
  });

  it.each<[ResearchStatus, string]>([
    ['running', 'View progress'],
    ['completed', 'View results'],
    ['partial', 'View results'],
    ['failed', 'View details'],
  ])('labels the primary button for a %s run "%s"', (status, label) => {
    renderRunList([buildAgentJob({ status })]);

    expect(screen.getByRole('button', { name: `${label} of Hotel Gran Marino` })).toBeInTheDocument();
  });

  it('opens the run from its primary button', async () => {
    const handlers = renderRunList([buildAgentJob()]);

    await userEvent.click(screen.getByRole('button', { name: /^View results/ }));

    expect(handlers.onSelect).toHaveBeenCalledWith('job-a');
  });

  it('offers a retry only for failed or partial runs', () => {
    renderRunList([buildAgentJob({ id: 'ok' }), buildAgentJob({
      id: 'bad',
      status: 'partial',
    })]);

    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('retries the run whose Retry button was clicked', async () => {
    const failed = buildAgentJob({
      id: 'bad',
      status: 'failed',
    });
    const handlers = renderRunList([failed]);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(handlers.onRetry).toHaveBeenCalledWith(failed);
  });

  it('hides delete while a run is still active', () => {
    renderRunList([buildAgentJob({ status: 'running' })]);

    expect(screen.queryByRole('button', { name: /delete run/i })).toBeNull();
  });

  it('deletes a finished run from its Delete button', async () => {
    const handlers = renderRunList([buildAgentJob()]);

    await userEvent.click(screen.getByRole('button', { name: 'Delete run Hotel Gran Marino' }));

    expect(handlers.onDelete).toHaveBeenCalledWith('job-a');
  });

  it('tells the user how to start when there are no runs', () => {
    renderRunList([]);

    expect(screen.getByText('No research runs yet. Start one with the brief above.')).toBeInTheDocument();
  });

  it('shows a loading state while the first list is fetched', () => {
    render(<AgentRunList jobs={[]} loading onSelect={vi.fn()} onRetry={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText('Loading runs…')).toBeInTheDocument();
  });
});
