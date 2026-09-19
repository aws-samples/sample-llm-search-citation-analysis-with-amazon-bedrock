import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildAgentJob, buildCafeTemplate, buildTemplate
} from './agent-fixtures';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import type { KeywordResearchItem } from '../../../types';
import { ResearchAgent } from './ResearchAgent';

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

/** Render the tab and wait for the runs list to arrive. */
export async function renderAgentTab(script: AgentTabScript): Promise<void> {
  scriptAgentTab(script);
  render(<ResearchAgent />);
  await screen.findByRole('list', { name: 'Research runs' });
}

/** Render the tab with one run available by id and open it. */
export async function renderAndOpenRun(job: KeywordResearchItem, action: RegExp): Promise<HTMLElement> {
  await renderAgentTab({
    history: [job],
    details: { [job.id]: job },
  });
  await userEvent.click(screen.getByRole('button', { name: action }));
  return screen.findByRole('dialog');
}
