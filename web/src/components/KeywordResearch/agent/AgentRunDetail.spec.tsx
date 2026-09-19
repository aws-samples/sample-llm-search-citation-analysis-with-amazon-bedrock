import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentRunDetail } from './AgentRunDetail';
import { buildAgentJob } from './agent-fixtures';
import type { KeywordResearchItem } from '../../../types';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

function renderDetail(job: KeywordResearchItem) {
  const onRetry = vi.fn();
  render(<AgentRunDetail job={job} groups={[]} onRetry={onRetry} />);
  return { onRetry };
}

describe('AgentRunDetail', () => {
  it('summarises the brief with the subject, audience and catalogue labels', () => {
    renderDetail(buildAgentJob());

    expect(screen.getByText('Hotel · for travellers')).toBeInTheDocument();
    expect(screen.getByText('Destination, Audience')).toBeInTheDocument();
    expect(screen.getByText('ES · es')).toBeInTheDocument();
    expect(screen.getByText('Hotels')).toBeInTheDocument();
  });

  it('puts the proposal right before the collapsed reasoning trace when the run has finished', () => {
    renderDetail(buildAgentJob());

    const proposal = screen.getByRole('region', { name: 'Proposed keywords' });
    const trace = screen.getByText('Reasoning trace').closest('details');
    expect(proposal.nextElementSibling).toBe(trace);
    expect(trace?.open).toBe(false);
    expect(screen.queryByRole('region', { name: 'Research progress' })).toBeNull();
  });

  it('shows the live progress and the running count instead of a proposal while the run is active', () => {
    renderDetail(buildAgentJob({
      status: 'running',
      keyword_count: 2,
      steps_done: 2,
    }));

    expect(screen.getByRole('region', { name: 'Research progress' })).toBeInTheDocument();
    expect(screen.getByText(/3 candidate keywords found so far/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Proposed keywords' })).toBeNull();
  });

  it('keeps the progress with its retry next to the proposal when the run is partial', async () => {
    const partial = buildAgentJob({ status: 'partial' });
    const { onRetry } = renderDetail(partial);

    expect(screen.getByRole('region', { name: 'Proposed keywords' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed steps' }));

    expect(onRetry).toHaveBeenCalledWith(partial);
  });

  it('shows why a failed run stopped', () => {
    renderDetail(buildAgentJob({
      status: 'failed',
      keywords: [],
      keyword_count: 0,
      error_message: 'The planner returned no queries.',
    }));

    expect(screen.getByText('The planner returned no queries.')).toBeInTheDocument();
    expect(screen.queryByText(/finished without candidates/)).toBeNull();
  });

  it('says so when a finished run found nothing', () => {
    renderDetail(buildAgentJob({
      keywords: [],
      keyword_count: 0,
    }));

    expect(screen.getByText(/The run finished without candidates/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Proposed keywords' })).toBeNull();
  });
});
