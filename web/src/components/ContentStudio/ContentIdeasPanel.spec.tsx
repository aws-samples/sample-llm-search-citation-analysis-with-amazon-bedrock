import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { ContentIdea } from '../../types';
import { ALL_SCOPE } from '../ui/reportScope';
import { ContentIdeasPanel } from './ContentIdeasPanel';
import { buildActionableIdea } from './ContentStudioView-fixtures';

function renderIdeasPanel(
  ideas: ContentIdea[], overrides: Partial<ComponentProps<typeof ContentIdeasPanel>> = {}
) {
  render(
    <ContentIdeasPanel
      keywords={[]}
      selection={{
        scope: ALL_SCOPE,
        selectScope: vi.fn(),
        scopePending: false,
        trackScopeRequest: () => () => undefined,
      }}
      params={{}}
      paging={{
        ideasTotal: null,
        ideasHasMore: false,
        ideasLoadingMore: false,
        loadMoreIdeas: vi.fn(),
      }}
      loading={false}
      ideas={ideas}
      ideasScope={null}
      ideasComputing={null}
      generating={false}
      selectedIdea={null}
      onCreateContent={vi.fn()}
      {...overrides}
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

/** Twelve ideas loaded of 30 on the server. */
const moreIdeasOnServer: Partial<ComponentProps<typeof ContentIdeasPanel>> = {
  paging: {
    ideasTotal: 30,
    ideasHasMore: true,
    ideasLoadingMore: false,
    loadMoreIdeas: vi.fn(),
  },
};

/** Renders the twelve ideas and presses "Show all", which reveals the two hidden ones. */
async function setupAllIdeasShown(overrides: Partial<ComponentProps<typeof ContentIdeasPanel>> = {}) {
  renderIdeasPanel(twelveIdeas, overrides);
  await userEvent.click(screen.getByRole('button', { name: 'Show all 12 ideas (2 more)' }));
}

describe('ContentIdeasPanel', () => {
  it('shows the first ten ideas and offers the rest behind one button', () => {
    renderIdeasPanel(twelveIdeas);

    expect(screen.getAllByRole('button', { name: 'Create Content' })).toHaveLength(10);
    expect(screen.queryByText('Idea 11')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 12 ideas (2 more)' })).toBeInTheDocument();
  });

  it('shows every idea once the user asks for all of them', async () => {
    await setupAllIdeasShown();

    expect(screen.getAllByRole('button', { name: 'Create Content' })).toHaveLength(12);
    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('offers no show-all button when every idea fits', () => {
    renderIdeasPanel(twelveIdeas.slice(0, 10));

    expect(queryShowAllElement()).not.toBeInTheDocument();
  });

  it('offers no next server page while loaded ideas are still hidden', () => {
    renderIdeasPanel(twelveIdeas, moreIdeasOnServer);

    expect(screen.queryByRole('button', { name: 'Load more ideas' })).not.toBeInTheDocument();
  });

  it('offers the next server page once every loaded idea is shown', async () => {
    await setupAllIdeasShown(moreIdeasOnServer);

    expect(screen.getByRole('button', { name: 'Load more ideas' })).toBeInTheDocument();
    expect(screen.getByText('Showing 12 of 30 ideas')).toBeInTheDocument();
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
