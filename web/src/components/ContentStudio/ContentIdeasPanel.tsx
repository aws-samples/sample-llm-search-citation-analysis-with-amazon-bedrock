import { useState } from 'react';
import type { ContentIdea } from '../../types';
import { CenteredEmpty } from '../ui/CenteredState';
import { LoadMoreButton } from '../ui/LoadMoreButton';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  DOCUMENT_TEXT_PATHS, WARNING_PATHS
} from '../ui/iconPaths';
import { ContentIdeaCard } from './ContentIdeaCard';
import { ContentIdeasSkeleton } from './ContentStudioSkeletons';

/** Ideas shown before "Show all": the list can hold dozens, and the first ones carry the highest priority. */
const INITIAL_VISIBLE_IDEAS = 10;

interface ContentIdeasPanelProps {
  readonly loading: boolean;
  readonly ideas: ContentIdea[];
  readonly actionableIdeas: ContentIdea[];
  readonly generating: boolean;
  readonly selectedIdea: ContentIdea | null;
  readonly onCreateContent: (idea: ContentIdea) => void;
  /** The active keyword an idea's brief would start from, if any. */
  readonly briefKeywordId?: (idea: ContentIdea) => string | undefined;
  /** Opens the Content Brief tab with this keyword ticked. */
  readonly onOpenBrief?: (keywordId: string) => void;
}

/** Setup notices (ideas the user cannot act on here), shown above the list so they are seen first. */
const NonActionableIdeas = ({ ideas }: { readonly ideas: ContentIdea[] }) => {
  const nonActionable = ideas.filter(i => !i.actionable);
  if (nonActionable.length === 0) return null;

  return (
    <>
      {nonActionable.map(idea => (
        <div key={idea.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <StrokeIcon className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" paths={WARNING_PATHS} />
            <div className="min-w-0">
              <h4 className="font-medium text-amber-800 break-words">{idea.title}</h4>
              <p className="text-sm text-amber-700 mt-1">{idea.description}</p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
};

const ActionableIdeas = ({
  loading, ideas, actionableIdeas, generating, selectedIdea, onCreateContent, briefKeywordId, onOpenBrief
}: ContentIdeasPanelProps) => {
  const [showAll, setShowAll] = useState(false);

  if (loading && ideas.length === 0) {
    return <ContentIdeasSkeleton />;
  }

  if (actionableIdeas.length === 0) {
    return (
      <CenteredEmpty
        icon={<StrokeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" paths={DOCUMENT_TEXT_PATHS} />}
        title="No content ideas available yet."
        hint="Run an analysis and configure your brands to get started."
      />
    );
  }

  const hidden = showAll ? 0 : Math.max(actionableIdeas.length - INITIAL_VISIBLE_IDEAS, 0);
  const visibleIdeas = hidden > 0 ? actionableIdeas.slice(0, INITIAL_VISIBLE_IDEAS) : actionableIdeas;

  return (
    <>
      <div className="grid gap-4">
        {visibleIdeas.map(idea => {
          const keywordId = briefKeywordId?.(idea);
          return (
            <ContentIdeaCard
              key={idea.id}
              idea={idea}
              onGenerate={onCreateContent}
              isGenerating={generating && selectedIdea?.id === idea.id}
              onOpenBrief={keywordId !== undefined && onOpenBrief ? () => onOpenBrief(keywordId) : undefined}
            />
          );
        })}
      </div>
      <LoadMoreButton
        onLoadMore={hidden > 0 ? () => setShowAll(true) : undefined}
        loading={false}
        label={`Show all ${actionableIdeas.length} ideas (${hidden} more)`}
      />
    </>
  );
};

/** The Content Ideas tab: setup notices, then the actionable ideas, the first ten until the user asks for all. */
export const ContentIdeasPanel = (props: ContentIdeasPanelProps) => (
  <div className="space-y-4">
    <NonActionableIdeas ideas={props.ideas} />
    <ActionableIdeas {...props} />
  </div>
);
