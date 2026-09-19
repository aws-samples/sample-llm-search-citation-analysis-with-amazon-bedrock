import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ContentIdea, GroupBriefIdea, Keyword
} from '../../types';
import { ContentStudioView } from './ContentStudioView';
import {
  buildActionableIdea,
  buildContentStudioHookResult,
  buildGroupBriefIdea,
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
  const { buildGroupBriefIdea } = await import('./ContentStudioView-fixtures');
  return {
    GroupBriefForm: ({
      keywords, onGenerate
    }: {
      keywords: Keyword[];
      onGenerate: (idea: GroupBriefIdea) => Promise<boolean>;
    }) => (
      <div>
        <span>Group brief received {keywords.length} keywords</span>
        <button type="button" onClick={() => { void onGenerate(buildGroupBriefIdea()); }}>
          Start mock group brief
        </button>
      </div>
    ),
  };
});

vi.mock('./ContentHistory', () => ({ ContentHistory: () => <div data-testid="content-history">History</div> }));

import { useContentStudio } from '../../hooks/useContentStudio';

const mockUseContentStudio = vi.mocked(useContentStudio);

describe('ContentStudioView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult());
  });

  it('renders all three Content Studio tabs', () => {
    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('Content Ideas')).toBeInTheDocument();
    expect(screen.getByText('Group Brief')).toBeInTheDocument();
    expect(screen.getByText('Generated Content')).toBeInTheDocument();
  });

  it('shows loading message when ideas are loading', () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ loading: true }));

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText(/Analyzing your data/u)).toBeInTheDocument();
  });

  it('renders cards for actionable ideas', () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ ideas: [buildActionableIdea()] }));

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('Create content for product comparisons')).toBeInTheDocument();
  });

  it('shows empty state when no actionable ideas exist', () => {
    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText(/No content ideas available/u)).toBeInTheDocument();
  });

  it('switches to generated content when its tab is clicked', async () => {
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Generated Content'));

    expect(screen.getByTestId('content-history')).toBeInTheDocument();
  });

  it('passes dashboard keywords to the Group Brief panel', async () => {
    const keywords: Keyword[] = [{
      id: 'keyword-1',
      keyword: 'Alpha keyword',
      created_at: '2026-01-01T00:00:00Z',
      status: 'active',
      group_ids: ['group-1'],
    }];
    render(<ContentStudioView keywords={keywords} />);

    await userEvent.click(screen.getByText('Group Brief'));

    expect(screen.getByText('Group brief received 1 keywords')).toBeInTheDocument();
  });

  it('switches to history after a group brief request succeeds', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: 'Generic Group',
    });
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ generateContent }));
    render(<ContentStudioView keywords={[]} />);

    await userEvent.click(screen.getByText('Group Brief'));
    await userEvent.click(screen.getByText('Start mock group brief'));

    await waitFor(() => {
      expect(generateContent).toHaveBeenCalledWith(buildGroupBriefIdea());
    });
    expect(await screen.findByTestId('content-history')).toBeInTheDocument();
  });

  it('keeps ordinary ideas behind the existing confirmation flow', async () => {
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

  it('shows unviewed count on generated content tab', () => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ unviewedCount: 5 }));

    render(<ContentStudioView keywords={[]} />);

    expect(screen.getByText('5 new')).toBeInTheDocument();
  });
});
