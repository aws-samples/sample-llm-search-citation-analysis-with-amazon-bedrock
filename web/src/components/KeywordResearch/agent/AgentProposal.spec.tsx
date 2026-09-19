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
import {
  CAFE_DIMENSIONS,
  HOTEL_DIMENSIONS,
  buildAgentJob,
  buildAgentKeyword,
  fullPromotionResponseFixture,
  promotedActiveKeywordFixture,
  selectedPromotionResponseFixture,
} from './agent-fixtures';
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

describe('groupProposalByDimension', () => {
  it('orders sections by the catalogue and puts unknown ids under Other last', () => {
    const sections = groupProposalByDimension(buildAgentJob().keywords ?? [], HOTEL_DIMENSIONS);

    expect(sections.map((section) => section.label)).toStrictEqual(['Destination', 'Audience', 'Other']);
    expect(sections[2].keywords.map((keyword) => keyword.keyword)).toStrictEqual(['escapada coruña']);
  });

  it('labels sections with the wording of the supplied catalogue', () => {
    const keywords = [
      buildAgentKeyword({
        keyword: 'cafetería centro coruña',
        dimension: 'location',
      }),
      buildAgentKeyword({
        keyword: 'brunch coruña',
        dimension: 'menu',
      }),
      buildAgentKeyword({
        keyword: 'hotel coruña',
        dimension: 'destination',
      }),
    ];

    const sections = groupProposalByDimension(keywords, CAFE_DIMENSIONS);

    expect(sections.map((section) => [section.label, section.keywords.length])).toStrictEqual([['Menu & drinks', 1], ['Location', 1], ['Other', 1]]);
  });

  it('puts the model other bucket under Other', () => {
    const sections = groupProposalByDimension([buildAgentKeyword({ dimension: 'other' })], HOTEL_DIMENSIONS);

    expect(sections.map((section) => section.id)).toStrictEqual(['other']);
  });

  it('returns no sections when the proposal is empty', () => {
    expect(groupProposalByDimension([], HOTEL_DIMENSIONS)).toStrictEqual([]);
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

  it('labels the sections from the run catalogue', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getAllByRole('heading', { level: 5 }).map((heading) => heading.textContent)).toStrictEqual(['Destination (1)', 'Audience (1)', 'Other (1)']);
  });

  it('shows the tracking recommendation evidence for each proposal term', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getAllByText('Recommended')).toHaveLength(2);
    expect(screen.getByText('Score 904')).toBeInTheDocument();
    expect(screen.getByText('Relevance 9/10; transactional intent; 1 provider.')).toBeInTheDocument();
    expect(screen.getByText(/not measured search volume/i)).toBeInTheDocument();
  });

  it('preselects the recommended subset with its status counts', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByLabelText('Select hotel coruña centro')).toBeChecked();
    expect(screen.getByLabelText('Select hotel coruña con niños')).toBeChecked();
    expect(screen.getByLabelText('Select escapada coruña')).not.toBeChecked();
    expect(screen.getByLabelText('2 selected active tracked keywords, 1 unselected inactive library keywords')).toBeInTheDocument();
  });

  it('preselects the destination group from the run brief', () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByLabelText('Keyword group')).toHaveValue('g1');
    expect(screen.getByRole('button', { name: /add selected as active \(2\) to “Hotel Gran Marino”/i })).toBeEnabled();
  });

  it('adds only the adjusted selection as active tracked keywords', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(selectedPromotionResponseFixture));
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    await userEvent.click(screen.getByLabelText('Select hotel coruña con niños'));
    await userEvent.click(screen.getByRole('button', { name: /add selected as active \(1\) to “Hotel Gran Marino”/i }));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockAuthenticatedFetch.mock.calls[0];
    expect(url).toBe('https://api.test.com/keywords/promote');
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      keywords: [job.keywords?.[0]],
      group_ids: ['g1'],
    });
  });

  it('adds the full proposal once using per-keyword statuses', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(fullPromotionResponseFixture));
    const job = buildAgentJob();
    const onKeywordsAdded = vi.fn();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} onKeywordsAdded={onKeywordsAdded} />);

    await userEvent.click(screen.getByRole('button', { name: /add full proposal \(2 active, 1 inactive\) to “Hotel Gran Marino”/i }));

    await waitFor(() => {
      expect(onKeywordsAdded).toHaveBeenCalledWith([promotedActiveKeywordFixture]);
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockAuthenticatedFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      keywords: [
        {
          ...job.keywords?.[0],
          status: 'active',
        },
        {
          ...job.keywords?.[1],
          status: 'active',
        },
        {
          ...job.keywords?.[2],
          status: 'inactive',
        },
      ],
      group_ids: ['g1'],
    });
  });

  it('restores the backend recommendation when reset is selected', async () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);
    await userEvent.click(screen.getByLabelText('Select hotel coruña centro'));
    await userEvent.click(screen.getByLabelText('Select escapada coruña'));

    await userEvent.click(screen.getByRole('button', { name: 'Reset to recommended (2)' }));

    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((box) => [box.getAttribute('aria-label'), box.checked])).toStrictEqual([
      ['Select hotel coruña centro', true],
      ['Select hotel coruña con niños', true],
      ['Select escapada coruña', false],
    ]);
  });

  it('updates only one dimension when its section control is used', async () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear section' })[0]);
    expect(screen.getByLabelText('1 selected active tracked keywords, 2 unselected inactive library keywords')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Select section' })[0]);
    expect(screen.getByLabelText('2 selected active tracked keywords, 1 unselected inactive library keywords')).toBeInTheDocument();
  });

  it('explains when the proposal uses the deterministic fallback', () => {
    const job = buildAgentJob({ proposal_source: 'fallback' });
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    expect(screen.getByText(/selection model was unavailable/i)).toBeInTheDocument();
  });

  it('keeps a legacy proposal usable without recommendation fields', () => {
    const job = buildAgentJob();
    const legacyKeywords = (job.keywords ?? []).map((keyword) => ({
      ...keyword,
      tracking: undefined,
      tracking_score: undefined,
      tracking_reason: undefined,
    }));
    render(<AgentProposal job={job} keywords={legacyKeywords} groups={GROUPS} />);

    expect(screen.getAllByText('Not scored (legacy run)')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Reset to recommended (0)' })).toBeDisabled();
    expect(screen.getByLabelText('0 selected active tracked keywords, 3 unselected inactive library keywords')).toBeInTheDocument();
  });

  it('exports the run with its proposal', async () => {
    const job = buildAgentJob();
    render(<AgentProposal job={job} keywords={job.keywords ?? []} groups={GROUPS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(exportAgentRun).toHaveBeenCalledWith(job, job.keywords);
  });
});
