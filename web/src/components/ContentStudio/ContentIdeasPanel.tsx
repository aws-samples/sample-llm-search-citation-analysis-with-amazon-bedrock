import { useState } from 'react';
import { ComputingState } from '../ui/ComputingState';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import type {
  ComputingResponse, ScopedResponseFields
} from '../../types/domain/scopeCoverage';
import type {
  ContentIdea, Keyword
} from '../../types';
import { ContentIdeaCard } from './ContentIdeaCard';
import { ContentIdeasSkeleton } from './ContentStudioSkeletons';
import { CenteredEmpty } from '../ui/CenteredState';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  DOCUMENT_TEXT_PATHS, WARNING_PATHS
} from '../ui/iconPaths';
import { ExportAllButton } from '../ui/ExportAllButton';
import { LoadMoreButton } from '../ui/LoadMoreButton';
import { exportParams } from '../../api/exports';
import { InsightsScopeSelector } from '../Insights/InsightsScopeSelector';
import type { ScopeSelection } from '../Insights/useScopeSelection';

const COUNT = new Intl.NumberFormat('en');

/** Ideas shown before "Show all": the list can hold dozens, and the first ones carry the highest priority. */
const INITIAL_VISIBLE_IDEAS = 10;

interface IdeasTabContentProps {
  readonly loading: boolean;
  readonly ideas: ContentIdea[];
  /** The ideas answer's coverage and source fields; the view job computing it while one runs. */
  readonly ideasScope: ScopedResponseFields | null;
  readonly ideasComputing: ComputingResponse | null;
  readonly actionableIdeas: ContentIdea[];
  readonly generating: boolean;
  readonly selectedIdea: ContentIdea | null;
  readonly onCreateContent: (idea: ContentIdea) => void;
  /** The active keyword an idea's brief would start from, if any. */
  readonly briefKeywordId?: (idea: ContentIdea) => string | undefined;
  /** Opens the Content Brief tab with this keyword ticked. */
  readonly onOpenBrief?: (keywordId: string) => void;
  /** Every loaded idea is on screen, not only the first ten. */
  readonly showAll: boolean;
  readonly onShowAll: () => void;
}

const IdeasTabContent = ({
  loading, ideas, ideasScope, ideasComputing, actionableIdeas, generating, selectedIdea, onCreateContent,
  briefKeywordId, onOpenBrief, showAll, onShowAll,
}: IdeasTabContentProps) => {
  if (loading && ideas.length === 0) {
    return ideasComputing === null ? <ContentIdeasSkeleton /> : <ComputingState subject="content ideas" />;
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
        <ScopeCoverageNote response={ideasScope} />
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
        onLoadMore={hidden > 0 ? onShowAll : undefined}
        loading={false}
        label={`Show all ${COUNT.format(actionableIdeas.length)} ideas (${COUNT.format(hidden)} more)`}
      />
    </>
  );
};

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

/** The ideas paging state of `useContentStudio`. */
export interface IdeasPagingState {
  readonly ideasTotal: number | null;
  readonly ideasHasMore: boolean;
  readonly ideasLoadingMore: boolean;
  readonly loadMoreIdeas: () => Promise<void>;
}

interface ContentIdeasPanelProps extends Omit<IdeasTabContentProps, 'actionableIdeas' | 'showAll' | 'onShowAll'> {
  readonly keywords: Keyword[];
  readonly selection: ScopeSelection;
  /** The scope and market the ideas were read with: Export all exports exactly those. */
  readonly params: Readonly<Record<string, string>>;
  readonly paging: IdeasPagingState;
}

/** "Showing 50 of 120 ideas" while ideas are left to load. */
function ShownOfTotal({
  shown, total
}: {
  readonly shown: number;
  readonly total: number | null 
}) {
  if (total === null || total <= shown) return null;
  return <p className="print-hidden text-sm text-gray-500">{`Showing ${COUNT.format(shown)} of ${COUNT.format(total)} ideas`}</p>;
}

/**
 * The Content Ideas tab (2.45.0 wave 5): the scope picker, Export all of every idea of the scope
 * and market, setup notices, then the actionable ideas: the first ten until the user asks for
 * all of the loaded ones, then "Load more ideas" through the rest of the scope.
 */
export function ContentIdeasPanel({
  keywords, selection, params, paging, ...content
}: ContentIdeasPanelProps) {
  const pending = content.loading || selection.scopePending;
  const actionableIdeas = content.ideas.filter(idea => idea.actionable);
  const [showAll, setShowAll] = useState(false);
  // "Load more ideas" pages the server list, so it waits until every loaded idea is on screen.
  const allShown = showAll || actionableIdeas.length <= INITIAL_VISIBLE_IDEAS;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <InsightsScopeSelector keywords={keywords} selection={selection} label="Ideas for" />
        <ExportAllButton view="content-ideas" params={pending ? null : exportParams(params)} />
      </div>
      <NonActionableIdeas ideas={content.ideas} />
      <IdeasTabContent
        {...content}
        actionableIdeas={actionableIdeas}
        showAll={showAll}
        onShowAll={() => setShowAll(true)}
      />
      {allShown && (
        <>
          <ShownOfTotal shown={content.ideas.length} total={paging.ideasTotal} />
          <LoadMoreButton
            onLoadMore={paging.ideasHasMore ? () => void paging.loadMoreIdeas() : undefined}
            loading={paging.ideasLoadingMore}
            label="Load more ideas"
            layoutClassName="print-hidden "
          />
        </>
      )}
    </div>
  );
}
