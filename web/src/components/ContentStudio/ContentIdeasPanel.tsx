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
}

const IdeasTabContent = ({
  loading, ideas, ideasScope, ideasComputing, actionableIdeas, generating, selectedIdea, onCreateContent
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

  return (
    <div className="grid gap-4">
      <ScopeCoverageNote response={ideasScope} />
      {actionableIdeas.map(idea => (
        <ContentIdeaCard
          key={idea.id}
          idea={idea}
          onGenerate={onCreateContent}
          isGenerating={generating && selectedIdea?.id === idea.id}
        />
      ))}
    </div>
  );
};

const NonActionableIdeas = ({ ideas }: { readonly ideas: ContentIdea[] }) => {
  const nonActionable = ideas.filter(i => !i.actionable);
  if (nonActionable.length === 0) return null;

  return (
    <>
      {nonActionable.map(idea => (
        <div key={idea.id} className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <StrokeIcon className="w-5 h-5 text-amber-500 mt-0.5" paths={WARNING_PATHS} />
            <div>
              <h4 className="font-medium text-amber-800">{idea.title}</h4>
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

interface ContentIdeasPanelProps extends Omit<IdeasTabContentProps, 'actionableIdeas'> {
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
 * and market, the ideas of the first page and "Load more ideas" through the rest.
 */
export function ContentIdeasPanel({
  keywords, selection, params, paging, ...content
}: ContentIdeasPanelProps) {
  const pending = content.loading || selection.scopePending;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <InsightsScopeSelector keywords={keywords} selection={selection} label="Ideas for" />
        <ExportAllButton view="content-ideas" params={pending ? null : exportParams(params)} />
      </div>
      <IdeasTabContent {...content} actionableIdeas={content.ideas.filter(idea => idea.actionable)} />
      <NonActionableIdeas ideas={content.ideas} />
      <ShownOfTotal shown={content.ideas.length} total={paging.ideasTotal} />
      <LoadMoreButton
        onLoadMore={paging.ideasHasMore ? () => void paging.loadMoreIdeas() : undefined}
        loading={paging.ideasLoadingMore}
        label="Load more ideas"
        layoutClassName="print-hidden "
      />
    </div>
  );
}
