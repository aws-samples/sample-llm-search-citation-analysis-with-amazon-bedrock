import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ContentBriefBatchRequest, ContentIdea, GroupBriefIdea, Keyword
} from '../../types';
import { buildTabContentKeyword } from '../Layout/TabContent-fixtures';
import { ContentStudioView } from './ContentStudioView';
import {
  buildActionableIdea,
  buildActiveBatch,
  buildContentBriefBatchRequest,
  buildContentStudioHookResult,
  buildGroupBriefIdea,
  buildMissingActiveBatch,
  buildPendingGenerateContentResponse,
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

function renderContentStudioView(
  overrides: Partial<ReturnType<typeof useContentStudio>> = {},
  keywords: Keyword[] = []
) {
  mockUseContentStudio.mockReturnValue(buildContentStudioHookResult(overrides));
  return render(<ContentStudioView keywords={keywords} />);
}

async function renderGeneratedContentTab(
  overrides: Partial<ReturnType<typeof useContentStudio>> = {}
): Promise<void> {
  renderContentStudioView(overrides);
  await userEvent.click(screen.getByText('Generated Content'));
}

const batchProgressCases = [
  {
    testName: 'shows exact progress for a running batch',
    batch: buildActiveBatch(),
    settledText: 'Content Brief batch: 1 of 3 jobs settled',
    countsText: '0 generated, 1 generating, 1 pending, 1 failed, 0 missing',
    outcomeText: /1 brief has failed/iu,
  },
  {
    testName: 'shows a safe unavailable outcome for a missing tombstone',
    batch: buildMissingActiveBatch(),
    settledText: 'Content Brief batch: 2 of 2 jobs settled',
    countsText: '1 generated, 0 generating, 0 pending, 0 failed, 1 missing',
    outcomeText: /1 brief is unavailable/iu,
  },
];

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
  it('renders Content Ideas, Content Brief, and Generated Content tabs', () => {
    renderContentStudioView();

    expect(screen.getByText('Content Ideas')).toBeInTheDocument();
    expect(screen.getByText('Content Brief')).toBeInTheDocument();
    expect(screen.getByText('Generated Content')).toBeInTheDocument();
  });

  it('shows the loading outcome when ideas are loading', () => {
    renderContentStudioView({ loading: true });

    expect(screen.getByText(/Analyzing your data/u)).toBeInTheDocument();
  });

  it('renders actionable idea cards when ideas are available', () => {
    renderContentStudioView({ ideas: [buildActionableIdea()] });

    expect(screen.getByText('Create content for product comparisons')).toBeInTheDocument();
  });

  it('shows the empty outcome when no actionable ideas exist', () => {
    renderContentStudioView();

    expect(screen.getByText(/No content ideas available/u)).toBeInTheDocument();
  });

  it('passes dashboard keywords through the Content Brief tab', async () => {
    renderContentStudioView({}, [buildTabContentKeyword()]);

    await userEvent.click(screen.getByText('Content Brief'));

    expect(screen.getByText('Content Brief received 1 keywords')).toBeInTheDocument();
  });

  it('switches to history after a combined brief is accepted', async () => {
    const generateContent = vi.fn().mockResolvedValue(
      buildPendingGenerateContentResponse('Alpha keyword')
    );
    renderContentStudioView({ generateContent });
    await userEvent.click(screen.getByText('Content Brief'));

    await userEvent.click(screen.getByText('Start mock combined brief'));

    await waitFor(() => {
      expect(generateContent).toHaveBeenCalledWith(buildGroupBriefIdea());
    });
    expect(await screen.findByTestId('content-history')).toBeInTheDocument();
  });

  it.each(batchNavigationCases)('$testName', async (batchCase) => {
    const generateContentBatch = vi.fn().mockResolvedValue(batchCase.response);
    renderContentStudioView({ generateContentBatch });

    await startMockContentBriefBatch();

    await waitFor(() => {
      expect(generateContentBatch).toHaveBeenCalledWith(buildContentBriefBatchRequest());
    });
    await waitFor(() => {
      expect(Boolean(screen.queryByTestId('content-history'))).toBe(batchCase.showsHistory);
    });
  });

  it.each(batchProgressCases)('$testName', async ({
    batch, settledText, countsText, outcomeText
  }) => {
    await renderGeneratedContentTab({ activeBatches: [batch] });

    expect(screen.getByText(settledText)).toBeInTheDocument();
    expect(screen.getByText(countsText)).toBeInTheDocument();
    expect(screen.getByText(outcomeText)).toBeInTheDocument();
  });

  it('renders progress cards for several background batches', async () => {
    await renderGeneratedContentTab({
      activeBatches: [
        buildActiveBatch({ batch_id: 'batch-newer' }),
        buildMissingActiveBatch('batch-older'),
      ],
    });

    expect(screen.getByText('Batch batch-newer')).toBeInTheDocument();
    expect(screen.getByText('Batch batch-older')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('refreshes the current history view without losing its transition behavior', async () => {
    const fetchHistory = vi.fn();
    const fetchIdeas = vi.fn();
    await renderGeneratedContentTab({
      fetchHistory,
      fetchIdeas,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(fetchIdeas).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary ideas behind their existing confirmation flow', async () => {
    const idea = buildActionableIdea();
    const generateContent = vi.fn().mockResolvedValue(
      buildPendingGenerateContentResponse('product comparisons')
    );
    renderContentStudioView({
      ideas: [idea],
      generateContent,
    });

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

  it('generates the content in the output language picked in the confirmation', async () => {
    const idea = buildActionableIdea();
    const generateContent = vi.fn().mockResolvedValue(
      buildPendingGenerateContentResponse('product comparisons')
    );
    renderContentStudioView({
      ideas: [idea],
      generateContent,
    });
    await userEvent.click(screen.getByText('Create content for product comparisons'));

    await userEvent.selectOptions(screen.getByLabelText('Output Language'), 'Spanish');
    await userEvent.click(screen.getByRole('button', { name: 'Generate Content' }));

    await waitFor(() => {
      expect(generateContent).toHaveBeenCalledWith({
        ...idea,
        output_language: 'Spanish',
      });
    });
  });

  it.each([
    ['says how many competitor sources will be analyzed', ['https://a.example/', 'https://b.example/'], 1],
    ['mentions no competitor sources when the idea has none', [], 0],
  ])('%s', async (_condition, competitorUrls, mentions) => {
    renderContentStudioView({ ideas: [buildActionableIdea({ competitor_urls: competitorUrls })] });

    await userEvent.click(screen.getByText('Create content for product comparisons'));

    expect(screen.queryAllByText('2 competitor sources will be analyzed')).toHaveLength(mentions);
  });

  it('loads neither ideas nor history when the Content Brief tab opens', async () => {
    const hookResult = buildContentStudioHookResult();
    mockUseContentStudio.mockReturnValue(hookResult);
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Content Brief'));

    expect(hookResult.fetchHistory).not.toHaveBeenCalledWith();
  });

  it('shows the unviewed count when generated content exists', () => {
    renderContentStudioView({ unviewedCount: 5 });

    expect(screen.getByText('5 new')).toBeInTheDocument();
  });
});
