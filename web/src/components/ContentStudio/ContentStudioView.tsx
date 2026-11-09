import {
  useState, useEffect, useCallback, useId, useMemo, type ReactNode
} from 'react';
import { useContentStudio } from '../../hooks/useContentStudio';
import { ContentIdeasPanel } from './ContentIdeasPanel';
import { ConfirmGenerateModal } from './ConfirmGenerateModal';
import { ContentHistory } from './ContentHistory';
import { GroupBriefForm } from './GroupBriefForm';
import { Spinner } from '../ui/Spinner';
import { RefreshTextButton } from '../ui/RefreshTextButton';
import {
  TabBar, TabPanel
} from '../ui/TabBar';
import { TabBadgeSkeleton } from './ContentStudioSkeletons';
import type {
  ContentBriefBatchRequest,
  ContentIdea,
  GroupBriefIdea,
  Keyword,
} from '../../types';
import { ContentBriefBatchProgress } from './ContentBriefBatchProgress';

type TabType = 'ideas' | 'brief' | 'history';

interface ContentStudioViewProps { readonly keywords: Keyword[]; }

interface TabsProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  highPriorityCount: number;
  /** The ideas have not arrived yet, so the high-priority count is unknown. */
  ideasPending: boolean;
  unviewedCount: number;
  /** The API stopped counting at its cap. */
  unviewedCountCapped: boolean;
  historyLength: number;
  /** The `TabPanel` the tabs control. */
  panelId: string;
}

const DOT_TONES = {
  error: ['bg-red-600', 'text-red-700'],
  warning: ['bg-amber-500', 'text-amber-700'],
} as const;

/** A tab's status: a dot and a word in the status colour (design system §2.2), not a filled pill. */
const StatusDot = ({
  tone, children
}: {
  readonly tone: keyof typeof DOT_TONES;
  readonly children: ReactNode;
}) => (
  <span className={`ml-2 inline-flex items-center gap-1.5 text-xs font-normal ${DOT_TONES[tone][1]}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone][0]}`} />
    {children}
  </span>
);

/** The Content Ideas badge, or its placeholder while the count is unknown, so the tabs after it stay put. */
const HighPriorityBadge = ({
  count, pending
}: {
  readonly count: number;
  readonly pending: boolean
}) => {
  if (pending) return <TabBadgeSkeleton />;
  if (count === 0) return null;
  return <StatusDot tone="error">{count} high priority</StatusDot>;
};

/** The Generated Content badge: unviewed pieces pulse; otherwise the size of the history. */
const HistoryBadge = ({
  unviewedCount, unviewedCountCapped, historyLength
}: {
  readonly unviewedCount: number;
  readonly unviewedCountCapped: boolean;
  readonly historyLength: number;
}) => {
  if (unviewedCount > 0) {
    return <StatusDot tone="warning">{unviewedCount}{unviewedCountCapped ? '+' : ''} new</StatusDot>;
  }
  if (historyLength === 0) return null;
  return (
    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
      {historyLength}
    </span>
  );
};

/** Finds the active keyword a content idea is about, so the idea can open a brief with it ticked. */
function useBriefKeywordLookup(keywords: readonly Keyword[]): (idea: ContentIdea) => string | undefined {
  const idsByText = useMemo(() => new Map(
    keywords
      .filter((keyword) => keyword.status === 'active')
      .map((keyword) => [keyword.keyword.trim().toLocaleLowerCase(), keyword.id])
  ), [keywords]);
  return useCallback(
    (idea: ContentIdea) => (idea.keyword ? idsByText.get(idea.keyword.trim().toLocaleLowerCase()) : undefined),
    [idsByText]
  );
}

/** The ideas tab is open and its first ideas are still on their way, so their counts are unknown. */
function ideasPending(activeTab: TabType, loading: boolean, ideas: readonly ContentIdea[]): boolean {
  return activeTab === 'ideas' && loading && ideas.length === 0;
}

const Tabs = ({
  activeTab, setActiveTab, highPriorityCount, ideasPending, unviewedCount, unviewedCountCapped, historyLength, panelId
}: TabsProps) => (
  <TabBar
    label="Content Studio"
    tabs={[
      {
        id: 'ideas',
        label: 'Content Ideas',
        badge: <HighPriorityBadge count={highPriorityCount} pending={ideasPending} />,
      },
      {
        id: 'brief',
        label: 'Content Brief',
      },
      {
        id: 'history',
        label: 'Generated Content',
        badge: <HistoryBadge unviewedCount={unviewedCount} unviewedCountCapped={unviewedCountCapped} historyLength={historyLength} />,
      },
    ]}
    activeId={activeTab}
    onChange={setActiveTab}
    panelId={panelId}
  />
);

interface GeneratingIndicatorProps {keyword: string;}

const GeneratingIndicator = ({ keyword }: GeneratingIndicatorProps) => (
  <output
    className="fixed bottom-4 right-4 max-w-sm bg-gray-900 dark:bg-gray-700 text-white dark:text-gray-50 border border-transparent dark:border-gray-600 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50"
  >
    <Spinner size="sm" />
    <div className="min-w-0">
      <p className="text-sm font-medium">Starting content generation...</p>
      <p className="text-xs text-gray-300 dark:text-gray-200 break-words">&quot;{keyword}&quot;</p>
    </div>
  </output>
);

export const ContentStudioView = ({ keywords }: ContentStudioViewProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('ideas');
  const [selectedIdea, setSelectedIdea] = useState<ContentIdea | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingIdea, setPendingIdea] = useState<ContentIdea | null>(null);
  // The keyword a content idea handed to the brief; the brief mounts with it ticked.
  const [briefKeywordIds, setBriefKeywordIds] = useState<readonly string[] | undefined>(undefined);
  const panelId = useId();
  const briefKeywordId = useBriefKeywordLookup(keywords);

  const {
    ideas,
    history,
    unviewedCount,
    unviewedCountCapped,
    historyHasMore,
    historyLoadingMore,
    loadMoreHistory,
    loading,
    generating,
    error,
    activeBatches,
    fetchIdeas,
    generateContent,
    generateContentBatch,
    fetchHistory,
    markViewed,
    deleteContent
  } = useContentStudio();

  const loadTab = useCallback((tab: TabType) => {
    if (tab === 'ideas') {
      fetchIdeas();
      return;
    }
    if (tab === 'history') {
      fetchHistory();
    }
  }, [fetchIdeas, fetchHistory]);

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab, loadTab]);

  const handleCreateContent = (idea: ContentIdea) => {
    setPendingIdea(idea);
    setShowConfirmModal(true);
  };

  const handleConfirmGenerate = async (outputLanguage: string) => {
    if (!pendingIdea) return;

    setShowConfirmModal(false);
    const ideaWithLanguage = {
      ...pendingIdea,
      output_language: outputLanguage
    } satisfies ContentIdea;
    setSelectedIdea(ideaWithLanguage);

    const result = await generateContent(ideaWithLanguage);

    if (result?.success) {
      setActiveTab('history');
      setSelectedIdea(null);
    }

    setPendingIdea(null);
  };

  const handleGenerateGroupBrief = async (idea: GroupBriefIdea): Promise<boolean> => {
    const result = await generateContent(idea);
    const generated = result?.success === true;
    if (generated) setActiveTab('history');
    return generated;
  };

  const handleGenerateGroupBriefBatch = async (
    request: ContentBriefBatchRequest
  ): Promise<boolean> => {
    const result = await generateContentBatch(request);
    const accepted = result?.success === true;
    if (accepted) setActiveTab('history');
    return accepted;
  };

  const handleCancelGenerate = () => {
    setShowConfirmModal(false);
    setPendingIdea(null);
  };

  const handleRefresh = () => loadTab(activeTab);

  const changeTab = (tab: TabType) => {
    setBriefKeywordIds(undefined);
    setActiveTab(tab);
  };

  const openBrief = (keywordId: string) => {
    setBriefKeywordIds([keywordId]);
    setActiveTab('brief');
  };

  const actionableIdeas = ideas.filter(idea => idea.actionable);
  const highPriorityCount = actionableIdeas.filter(i => i.priority === 'high').length;

  return (
    <div className="space-y-6">
      {activeTab === 'brief' ? null : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            AI-powered content suggestions based on your visibility gaps and competitor analysis
          </p>
          <RefreshTextButton onRefresh={handleRefresh} loading={loading} showIcon />
        </div>
      )}

      <Tabs
        activeTab={activeTab}
        setActiveTab={changeTab}
        highPriorityCount={highPriorityCount}
        ideasPending={ideasPending(activeTab, loading, ideas)}
        unviewedCount={unviewedCount}
        unviewedCountCapped={unviewedCountCapped}
        historyLength={history.length}
        panelId={panelId}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      <TabPanel id={panelId} activeId={activeTab}>
        {activeTab === 'ideas' && (
          <ContentIdeasPanel
            loading={loading}
            ideas={ideas}
            actionableIdeas={actionableIdeas}
            generating={generating}
            selectedIdea={selectedIdea}
            onCreateContent={handleCreateContent}
            briefKeywordId={briefKeywordId}
            onOpenBrief={openBrief}
          />
        )}

        {activeTab === 'brief' && (
          <GroupBriefForm
            keywords={keywords}
            generating={generating}
            onGenerate={handleGenerateGroupBrief}
            onGenerateBatch={handleGenerateGroupBriefBatch}
            initialKeywordIds={briefKeywordIds}
          />
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {activeBatches.map((batch) => (
              <ContentBriefBatchProgress key={batch.batch_id} batch={batch} />
            ))}
            <ContentHistory
              history={history}
              loading={loading}
              onDelete={deleteContent}
              onMarkViewed={markViewed}
              onLoadMore={historyHasMore ? () => void loadMoreHistory() : undefined}
              loadingMore={historyLoadingMore}
            />
          </div>
        )}
      </TabPanel>

      {generating && selectedIdea?.keyword && (
        <GeneratingIndicator keyword={selectedIdea.keyword} />
      )}

      {showConfirmModal && pendingIdea && (
        <ConfirmGenerateModal
          idea={pendingIdea}
          onConfirm={handleConfirmGenerate}
          onCancel={handleCancelGenerate}
        />
      )}
    </div>
  );
};
