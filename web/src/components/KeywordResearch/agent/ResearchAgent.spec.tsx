import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchAgent } from './ResearchAgent';
import {
  buildAgentJob, buildCafeTemplate, buildTemplate
} from './agent-fixtures';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import type { KeywordResearchItem } from '../../../types';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';

interface AgentTabScript {
  history: KeywordResearchItem[];
  /** GET /{id} answers; a missing id answers 404. */
  details?: Record<string, KeywordResearchItem>;
}

function scriptAgentTab(script: AgentTabScript): void {
  mockAuthenticatedFetch.mockImplementation((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/keyword-research/templates')) {
      return Promise.resolve(createMockJsonResponse({
        items: [buildTemplate(), buildCafeTemplate()],
        count: 2,
      }));
    }
    if (url.includes('/keyword-groups')) {
      return Promise.resolve(createMockJsonResponse({
        groups: [],
        count: 0,
      }));
    }
    if (url.includes('/keyword-research/history')) {
      return Promise.resolve(createMockJsonResponse({ items: script.history }));
    }
    if (method === 'POST' && url.endsWith('/keyword-research/agent')) {
      return Promise.resolve(createMockJsonResponse(buildAgentJob({
        id: 'job-new',
        status: 'pending',
        keyword_count: 0,
      }), 202));
    }
    const id = url.slice(url.lastIndexOf('/') + 1);
    const detail = script.details?.[id];
    if (detail === undefined) return Promise.resolve(createMockJsonResponse({ error: 'Research not found' }, 404));
    return Promise.resolve(createMockJsonResponse(detail));
  });
}

/** Renders the tab and waits for the runs list to arrive. */
async function renderAgentTab(script: AgentTabScript): Promise<void> {
  scriptAgentTab(script);
  render(<ResearchAgent />);
  await screen.findByRole('list', { name: 'Research runs' });
}

/** Renders the tab with one run (listed and readable by id) and opens it. */
async function renderAndOpenRun(job: KeywordResearchItem, action: RegExp): Promise<HTMLElement> {
  await renderAgentTab({
    history: [job],
    details: { [job.id]: job },
  });
  await userEvent.click(screen.getByRole('button', { name: action }));
  return screen.findByRole('dialog');
}

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
