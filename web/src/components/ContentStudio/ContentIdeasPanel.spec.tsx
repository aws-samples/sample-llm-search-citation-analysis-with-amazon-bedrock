import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ContentIdea } from '../../types';
import { ContentIdeasPanel } from './ContentIdeasPanel';
import { buildActionableIdea } from './ContentStudioView-fixtures';

function renderIdeasPanel(
  ideas: ContentIdea[], handoff: Partial<ComponentProps<typeof ContentIdeasPanel>> = {}
) {
  render(
    <ContentIdeasPanel
      {...handoff}
      loading={false}
      ideas={ideas}
      actionableIdeas={ideas.filter((idea) => idea.actionable)}
      generating={false}
      selectedIdea={null}
      onCreateContent={vi.fn()}
    />
  );
}

function queryShowAllElement() {
  return screen.queryByRole('button', { name: /^Show all/u });
}

const twelveIdeas = Array.from({ length: 12 }, (_, index) => buildActionableIdea({
  id: `idea-${index}`,
  title: `Idea ${index + 1}`,
}));

describe('ContentIdeasPanel', () => {
  it('shows the first ten ideas and offers the rest behind one button', () => {
    renderIdeasPanel(twelveIdeas);

    expect(screen.getAllByRole('button', { name: 'Create Content' })).toHaveLength(10);
    expect(screen.queryByText('Idea 11')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 12 ideas (2 more)' })).toBeInTheDocument();
  });

  it('shows every idea once the user asks for all of them', async () => {
    renderIdeasPanel(twelveIdeas);

    await userEvent.click(screen.getByRole('button', { name: 'Show all 12 ideas (2 more)' }));

    expect(screen.getAllByRole('button', { name: 'Create Content' })).toHaveLength(12);
    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('offers no show-all button when every idea fits', () => {
    renderIdeasPanel(twelveIdeas.slice(0, 10));

    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('puts setup notices above the actionable ideas', () => {
    renderIdeasPanel([
      twelveIdeas[0],
      buildActionableIdea({
        id: 'setup',
        title: 'Configure your brands',
        actionable: false,
      }),
    ]);

    const notice = screen.getByRole('heading', { name: 'Configure your brands' });
    const idea = screen.getByRole('heading', { name: 'Idea 1' });
    expect(notice.compareDocumentPosition(idea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the brief handoff only for ideas with an active keyword', async () => {
    const onOpenBrief = vi.fn();
    renderIdeasPanel(twelveIdeas.slice(0, 2), {
      briefKeywordId: (idea) => (idea.id === 'idea-1' ? 'keyword-7' : undefined),
      onOpenBrief,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Open in Content Brief' }));

    expect(screen.getAllByRole('button', { name: 'Open in Content Brief' })).toHaveLength(1);
    expect(onOpenBrief).toHaveBeenCalledWith('keyword-7');
  });
});
