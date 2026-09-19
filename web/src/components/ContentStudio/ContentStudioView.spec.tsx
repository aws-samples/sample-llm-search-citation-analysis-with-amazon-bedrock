import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentStudioView } from './ContentStudioView';
import {
  buildActionableIdea, buildContentStudioHookResult 
} from './ContentStudioView-fixtures';

vi.mock('../../hooks/useContentStudio', () => ({useContentStudio: vi.fn(),}));

vi.mock('./ContentIdeaCard', () => ({
  ContentIdeaCard: ({ idea }: { idea: { keyword: string } }) => (
    <div data-testid="idea-card">{idea.keyword}</div>
  ),
}));

vi.mock('./ContentHistory', () => ({ContentHistory: () => <div data-testid="content-history">History</div>,}));

import { useContentStudio } from '../../hooks/useContentStudio';

const mockUseContentStudio = vi.mocked(useContentStudio);

describe('ContentStudioView', () => {
  beforeEach(() => {
    mockUseContentStudio.mockReturnValue(buildContentStudioHookResult());
  });

  describe('initial render', () => {
    it('renders tab buttons', () => {
      render(<ContentStudioView />);

      expect(screen.getByText('Content Ideas')).toBeInTheDocument();
      expect(screen.getByText('Generated Content')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading with no ideas', () => {
      mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ loading: true }));

      render(<ContentStudioView />);

      expect(screen.getByText(/Analyzing your data/)).toBeInTheDocument();
    });
  });

  describe('with ideas', () => {
    it('renders idea cards for actionable ideas', () => {
      mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ ideas: [buildActionableIdea()] }));

      render(<ContentStudioView />);

      expect(screen.getByTestId('idea-card')).toBeInTheDocument();
    });

    it('shows empty state when no actionable ideas', () => {
      render(<ContentStudioView />);

      expect(screen.getByText(/No content ideas available/)).toBeInTheDocument();
    });
  });

  describe('tab switching', () => {
    it('switches to history tab when clicked', async () => {
      render(<ContentStudioView />);

      await userEvent.click(screen.getByText('Generated Content'));

      expect(screen.getByTestId('content-history')).toBeInTheDocument();
    });
  });

  describe('unviewed badge', () => {
    it('shows unviewed count badge on history tab', () => {
      mockUseContentStudio.mockReturnValue(buildContentStudioHookResult({ unviewedCount: 5 }));

      render(<ContentStudioView />);

      expect(screen.getByText('5 new')).toBeInTheDocument();
    });
  });
});
