import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ContentBriefBatchRequest, ContentIdea, GroupBriefIdea, Keyword
} from '../../types';
import { ContentStudioView } from './ContentStudioView';
import {
  buildActionableIdea,
  buildActiveBatch,
  buildContentBriefBatchRequest,
  buildContentStudioHookResult,
  buildGroupBriefIdea,
  buildMissingActiveBatch,
  startMockContentBriefBatch,
} from './ContentStudioView-fixtures';

vi.mock('../../hooks/useContentStudio', () => ({ useContentStudio: vi.fn() }));

vi.mock('./ContentIdeaCard', () => ({
  ContentIdeaCard: ({
    idea, onGenerate
  }: {
    idea: ContentIdea;
    onGenerate: (idea: ContentIdea) => void;
  }) => (
    <button type="button" onClick={() => onGenerate(idea)}>
      Create content for {idea.keyword}
    </button>
  ),
}));

vi.mock('./GroupBriefForm', async () => {
  const fixtures = await import('./ContentStudioView-fixtures');
  return {
    GroupBriefForm: ({
      keywords, onGenerate, onGenerateBatch
    }: {
      keywords: Keyword[];
      onGenerate: (idea: GroupBriefIdea) => Promise<boolean>;
      onGenerateBatch: (request: ContentBriefBatchRequest) => Promise<boolean>;
    }) => (
      <div>
        <span>Content Brief received {keywords.length} keywords</span>
        <button
          type="button"
          onClick={() => { void onGenerate(fixtures.buildGroupBriefIdea()); }}
        >
          Start mock combined brief
        </button>
        <button
          type="button"
          onClick={() => { void onGenerateBatch(fixtures.buildContentBriefBatchRequest()); }}
        >
          Start mock brief batch
        </button>
      </div>
    ),
  };
});

vi.mock('./ContentHistory', () => ({ ContentHistory: () => <div data-testid="content-history">History</div> }));

import { useContentStudio } from '../../hooks/useContentStudio';

const mockUseContentStudio = vi.mocked(useContentStudio);

const batchNavigationCases = [
  {
    testName: 'switches to history when a batch request is accepted',
    response: {
      success: true,
      batch_id: 'batch-1',
    },
    showsHistory: true,
  },
  {
    testName: 'keeps the brief form open when a batch response is declined',
    response: {
      success: false,
      batch_id: 'batch-1',
      error: 'Batch was not accepted',
    },
    showsHistory: false,
  },
  {
    testName: 'keeps the brief form open when the batch request is lost',
    response: null,
    showsHistory: false,
  },
];

describe('ContentStudioView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult());
  });

  it('renders Content Ideas, Content Brief, and Generated Content tabs', () => {
    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('Content Ideas')).toBeInTheDocument();
    expect(screen.getByText('Content Brief')).toBeInTheDocument();
    expect(screen.getByText('Generated Content')).toBeInTheDocument();
  });

  it('shows the loading outcome when ideas are loading', () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ loading: true }));

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText(/Analyzing your data/u)).toBeInTheDocument();
  });

  it('renders actionable idea cards when ideas are available', () => {
    mockUseContentStudio.mockReturnValue(
      buildContentStudioHookResult({ ideas: [buildActionableIdea()] })
    );

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('Create content for product comparisons')).toBeInTheDocument();
  });

  it('shows the empty outcome when no actionable ideas exist', () => {
    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText(/No content ideas available/u)).toBeInTheDocument();
  });

  it('passes dashboard keywords through the Content Brief tab', async () => {
    const keywords: Keyword[] = [{
      id: 'keyword-1',
      keyword: 'Alpha keyword',
      created_at: '2026-01-01T00:00:00Z',
      status: 'active',
      group_ids: ['group-1'],
    }];
    render(<ContentStudioView keywords={keywords} />);

    await userEvent.click(screen.getByText('Content Brief'));

    expect(screen.getByText('Content Brief received 1 keywords')).toBeInTheDocument();
  });

  it('switches to history after a combined brief is accepted', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: 'Alpha keyword',
    });
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ generateContent }));
    render(<ContentStudioView keywords={[]} />);
    await userEvent.click(screen.getByText('Content Brief'));

    await userEvent.click(screen.getByText('Start mock combined brief'));

    await waitFor(() => {
      expect(generateContent).toHaveBeenCalledWith(buildGroupBriefIdea());
    });
    expect(await screen.findByTestId('content-history')).toBeInTheDocument();
  });

  it.each(batchNavigationCases)('$testName', async (batchCase) => {
    const generateContentBatch = vi.fn().mockResolvedValue(batchCase.response);
    mockUseContentStudio.mockReturnValue(
      buildContentStudioHookResult({ generateContentBatch })
    );
    render(<ContentStudioView keywords={[]} />);

    await startMockContentBriefBatch();

    await waitFor(() => {
      expect(generateContentBatch).toHaveBeenCalledWith(buildContentBriefBatchRequest());
    });
    await waitFor(() => {
      expect(Boolean(screen.queryByTestId('content-history'))).toBe(batchCase.showsHistory);
    });
  });

  it('shows exact progress for a running batch', async () => {
    mockUseContentStudio.mockReturnValue(
      buildContentStudioHookResult({ activeBatches: [buildActiveBatch()] })
    );
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Generated Content'));

    expect(screen.getByText('Content Brief batch: 1 of 3 jobs settled')).toBeInTheDocument();
    expect(screen.getByText(
      '0 generated, 1 generating, 1 pending, 1 failed, 0 missing'
    )).toBeInTheDocument();
    expect(screen.getByText(/1 brief has failed/iu)).toBeInTheDocument();
  });

  it('shows a safe unavailable outcome for a missing tombstone', async () => {
    const activeBatches = [buildMissingActiveBatch()];
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ activeBatches }));
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Generated Content'));

    expect(screen.getByText('Content Brief batch: 2 of 2 jobs settled')).toBeInTheDocument();
    expect(screen.getByText(
      '1 generated, 0 generating, 0 pending, 0 failed, 1 missing'
    )).toBeInTheDocument();
    expect(screen.getByText(/1 brief is unavailable/iu)).toBeInTheDocument();
  });

  it('renders progress cards for several background batches', async () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({
      activeBatches: [
        buildActiveBatch({ batch_id: 'batch-newer' }),
        buildMissingActiveBatch('batch-older'),
      ],
    }));
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Generated Content'));

    expect(screen.getByText('Batch batch-newer')).toBeInTheDocument();
    expect(screen.getByText('Batch batch-older')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('refreshes the current history view without losing its transition behavior', async () => {
    const fetchHistory = vi.fn();
    const fetchIdeas = vi.fn();
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({
      fetchHistory,
      fetchIdeas,
    }));
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Generated Content'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(fetchIdeas).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary ideas behind their existing confirmation flow', async () => {
    const idea = buildActionableIdea();
    const generateContent = vi.fn().mockResolvedValue({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: idea.keyword,
    });
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({
      ideas: [idea],
      generateContent,
    }));
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Create content for product comparisons'));

    expect(screen.getByText('Create Content')).toBeInTheDocument();
    expect(generateContent).not.toHaveBeenCalledWith(expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Generate Content' }));
    await waitFor(() => {
      expect(generateContent).toHaveBeenCalledWith({
        ...idea,
        output_language: 'English',
      });
    });
  });

  it('shows the unviewed count when generated content exists', () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ unviewedCount: 5 }));

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('5 new')).toBeInTheDocument();
  });
});
