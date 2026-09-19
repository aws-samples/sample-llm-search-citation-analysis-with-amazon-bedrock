import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildAgentJob } from './agent-fixtures';
import {
  renderAgentTab, renderAndOpenRun
} from './ResearchAgent-fixtures';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

describe('ResearchAgent', () => {
  it('shows the brief above the runs and no open run', async () => {
    await renderAgentTab({ history: [buildAgentJob()] });

    expect(screen.getByRole('form', { name: 'Research agent brief' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the run in a modal titled with its seed when View results is clicked', async () => {
    const finished = buildAgentJob({ system_prompt: 'You are a hotel SEO researcher.' });
    await renderAgentTab({
      history: [buildAgentJob({ system_prompt: undefined })],
      details: { 'job-a': finished },
    });

    await userEvent.click(screen.getByRole('button', { name: /^View results/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Hotel Gran Marino' })).toBeInTheDocument();
    expect(within(dialog).getByText(/^Hotels · started /)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /3 proposed keywords/ })).toBeInTheDocument();
  });

  it('keeps the reasoning trace collapsed behind the proposal', async () => {
    const dialog = await renderAndOpenRun(buildAgentJob(), /^View results/);

    const trace = within(dialog).getByText('Reasoning trace').closest('details');
    expect(trace?.open).toBe(false);
    expect(within(dialog).getByText('2 rounds')).toBeInTheDocument();
  });

  it('shows the live progress instead of a proposal when the opened run is still active', async () => {
    const dialog = await renderAndOpenRun(buildAgentJob({
      status: 'running',
      keyword_count: 12,
      steps_done: 2,
      keywords: [],
    }), /^View progress/);

    expect(within(dialog).getByRole('region', { name: 'Research progress' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: 'Proposed keywords' })).toBeNull();
  });

  it('closes the modal from its close button and keeps the run in the list', async () => {
    await renderAndOpenRun(buildAgentJob(), /^View results/);

    await userEvent.click(screen.getByLabelText('Close modal'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^View results/ })).toBeInTheDocument();
  });

  it('adds a started run to the top of the list without opening it', async () => {
    await renderAgentTab({ history: [buildAgentJob()] });
    await screen.findByRole('option', { name: 'Hotels' });

    await userEvent.type(screen.getByLabelText('Hotel (or seed)'), 'Hotel Atlántico');
    await userEvent.click(screen.getByRole('button', { name: 'Start research' }));

    const runs = screen.getByRole('list', { name: 'Research runs' });
    await waitFor(() => {
      expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(within(runs).getAllByRole('button', { name: /^View / }).map((button) => button.textContent)).toStrictEqual(['View progress', 'View results']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
