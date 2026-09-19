import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AgentProposal, groupProposalByDimension
} from './AgentProposal';
import { buildAgentJob } from './agent-fixtures';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import type { KeywordGroup } from '../../../types';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

vi.mock('./agentExport', () => ({ exportAgentRun: vi.fn(() => Promise.resolve()) }));

import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { exportAgentRun } from './agentExport';

const GROUPS: KeywordGroup[] = [
  {
    id: 'g1',
    name: 'Hotel Gran Marino',
    description: '',
    keyword_count: 12,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'g2',
    name: 'Hotel Atlántico',
    description: '',
    keyword_count: 4,
    created_at: '',
    updated_at: '',
  },
];

const PROMOTED_KEYWORD = {
  id: 'k1',
  keyword: 'hotel coruña centro',
  status: 'active',
};

describe('groupProposalByDimension', () => {
  it('orders sections by the form dimensions and puts unknown ones under Other', () => {
    const sections = groupProposalByDimension(buildAgentJob().keywords ?? []);

    expect(sections.map((section) => section.label)).toStrictEqual(['Destination', 'Audience', 'Other']);
    expect(sections[2].keywords.map((keyword) => keyword.keyword)).toStrictEqual(['escapada coruña']);
  });

  it('is empty for an empty proposal', () => {
    expect(groupProposalByDimension([])).toStrictEqual([]);
  });
});

describe('AgentProposal', () => {
  it('renders one section per dimension with the candidate count', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByRole('heading', { name: /3 proposed keywords/ })).toBeInTheDocument();
    expect(screen.getByText(/selected from 41 candidates/)).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(3);
  });

  it('preselects the group the run was started for', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByLabelText('Keyword group')).toHaveValue('g1');
    expect(screen.getByRole('button', { name: /add keywords to “Hotel Gran Marino”/i })).toBeDisabled();
  });

  it('promotes the ticked keywords into the chosen group', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      created: 1,
      skipped: 0,
      created_keywords: [PROMOTED_KEYWORD],
      skipped_keywords: [],
    }));
    const job = buildAgentJob();
    const onKeywordsAdded = vi.fn();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} onKeywordsAdded={onKeywordsAdded} />);

    await userEvent.click(screen.getByLabelText('Select hotel coruña centro'));
    await userEvent.click(screen.getByRole('button', { name: /add 1 keywords to “Hotel Gran Marino”/i }));

    await waitFor(() => {
      expect(onKeywordsAdded).toHaveBeenCalledWith([PROMOTED_KEYWORD]);
    });
    const [url, init] = mockAuthenticatedFetch.mock.calls[0];
    expect(url).toBe('https://api.test.com/keywords/promote');
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      keywords: [expect.objectContaining({ keyword: 'hotel coruña centro' })],
      group_ids: ['g1'],
    });
  });

  it('selects and clears a whole dimension section at once', async () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Select section' })[0]);
    expect(screen.getByText('1 of 500 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear section' }));
    expect(screen.getByText('0 of 500 selected')).toBeInTheDocument();
  });

  it('explains when the list is the fallback rather than the model selection', () => {
    const job = buildAgentJob({ proposal_source: 'fallback' });
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByText(/selection model was unavailable/i)).toBeInTheDocument();
  });

  it('exports the run with its proposal', async () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(exportAgentRun).toHaveBeenCalledWith(job, job.keywords);
  });
});
