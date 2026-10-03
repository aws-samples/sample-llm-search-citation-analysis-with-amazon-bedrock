import {
  useState, useEffect, useCallback
} from 'react';
import type { ReactNode } from 'react';
import { useContentStudio } from '../../hooks/useContentStudio';
import { ContentIdeaCard } from './ContentIdeaCard';
import { ContentHistory } from './ContentHistory';
import { GroupBriefForm } from './GroupBriefForm';
import { GROUP_BRIEF_LANGUAGES } from './GroupBriefForm-source';
import { Spinner } from '../ui/Spinner';
import type {
  ContentBriefBatchRequest,
  ContentIdea,
  GroupBriefIdea,
  Keyword,
} from '../../types';
import { ContentBriefBatchProgress } from './ContentBriefBatchProgress';
import { OverlayDialog } from './OverlayDialog';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  BOLT_PATHS, DOCUMENT_TEXT_PATHS, LIGHTBULB_PATHS, REFRESH_PATHS, WARNING_PATHS 
} from '../ui/iconPaths';

type TabType = 'ideas' | 'brief' | 'history';

interface ContentStudioViewProps { readonly keywords: Keyword[]; }

interface IdeasTabContentProps {
  loading: boolean;
  ideas: ContentIdea[];
  actionableIdeas: ContentIdea[];
  generating: boolean;
  selectedIdea: ContentIdea | null;
  onCreateContent: (idea: ContentIdea) => void;
}

const IdeasTabContent = ({
  loading, ideas, actionableIdeas, generating, selectedIdea, onCreateContent
}: IdeasTabContentProps) => {
  if (loading && ideas.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Spinner size="lg" className="mx-auto mb-4" />
        Analyzing your data for content opportunities...
      </div>
    );
  }

  if (actionableIdeas.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <StrokeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" paths={DOCUMENT_TEXT_PATHS} />
        <p>No content ideas available yet.</p>
        <p className="text-sm mt-1">Run an analysis and configure your brands to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
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

const NonActionableIdeas = ({ ideas }: { ideas: ContentIdea[] }) => {
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

interface ConfirmGenerateModalProps {
  readonly idea: ContentIdea;
  readonly onConfirm: (outputLanguage: string) => void;
  readonly onCancel: () => void;
}

function ConfirmGenerateModal({
  idea, onConfirm, onCancel
}: ConfirmGenerateModalProps) {
  const [outputLanguage, setOutputLanguage] = useState('English');

  return (
    <OverlayDialog onDismiss={onCancel} panelClassName="max-w-md w-full p-6">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-orange-100 rounded-full">
          <StrokeIcon className="w-6 h-6 text-orange-600" paths={LIGHTBULB_PATHS} />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">Create Content</h3>
          <p className="text-sm text-gray-600 mt-2">
            AI will analyze competitor content and generate optimized content for:
          </p>
          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
            <p className="font-medium text-gray-900">{idea.title}</p>
            <p className="text-sm text-gray-500 mt-1">Keyword: {idea.keyword}</p>
            {idea.competitor_urls && idea.competitor_urls.length > 0 && (
              <p className="text-sm text-gray-500">{idea.competitor_urls.length} competitor sources will be analyzed</p>
            )}
          </div>
          <div className="mt-3">
            <label htmlFor="output-language" className="block text-sm font-medium text-gray-700 mb-1">
              Output Language
            </label>
            <select
              id="output-language"
              value={outputLanguage}
              onChange={e => setOutputLanguage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {GROUP_BRIEF_LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            This may take up to a minute. You&apos;ll be notified when it&apos;s ready.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(outputLanguage)}
          className="flex-1 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          <StrokeIcon className="w-4 h-4" paths={BOLT_PATHS} />
          Generate Content
        </button>
      </div>
    </OverlayDialog>
  );
}

interface HeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

const Header = ({
  loading, onRefresh
}: HeaderProps) => (
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm text-gray-500 mt-1">
        AI-powered content suggestions based on your visibility gaps and competitor analysis
      </p>
    </div>
    <button
      onClick={onRefresh}
      disabled={loading}
      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center gap-2"
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <StrokeIcon className="w-4 h-4" paths={REFRESH_PATHS} />
      )}
      Refresh
    </button>
  </div>
);

interface TabButtonProps {
  tab: TabType;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  /** Appended to the base classes, before the active-state classes. */
  positionClassName?: string;
  children: ReactNode;
}

const TabButton = ({
  tab, activeTab, setActiveTab, positionClassName = '', children
}: TabButtonProps) => (
  <button
    onClick={() => setActiveTab(tab)}
    className={`pb-3 text-sm font-medium border-b-2 transition-colors${positionClassName} ${
      activeTab === tab
        ? 'border-gray-900 text-gray-900'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`}
  >
    {children}
  </button>
);

interface TabsProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  highPriorityCount: number;
  unviewedCount: number;
  historyLength: number;
}

const Tabs = ({
  activeTab, setActiveTab, highPriorityCount, unviewedCount, historyLength
}: TabsProps) => (
  <div className="border-b border-gray-200">
    <nav className="flex gap-8 overflow-x-auto">
      <TabButton tab="ideas" activeTab={activeTab} setActiveTab={setActiveTab}>
        Content Ideas
        {highPriorityCount > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
            {highPriorityCount} high priority
          </span>
        )}
      </TabButton>
      <TabButton tab="brief" activeTab={activeTab} setActiveTab={setActiveTab}>
        Content Brief
      </TabButton>
      <TabButton tab="history" activeTab={activeTab} setActiveTab={setActiveTab} positionClassName=" relative">
        Generated Content
        {unviewedCount > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-orange-500 text-white rounded-full font-semibold animate-pulse">
            {unviewedCount} new
          </span>
        )}
        {unviewedCount === 0 && historyLength > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-full">
            {historyLength}
          </span>
        )}
      </TabButton>
    </nav>
  </div>
);

interface GeneratingIndicatorProps {keyword: string;}

const GeneratingIndicator = ({ keyword }: GeneratingIndicatorProps) => (
  <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
    <Spinner size="sm" />
    <div>
      <p className="text-sm font-medium">Starting content generation...</p>
      <p className="text-xs text-gray-300">&quot;{keyword}&quot;</p>
    </div>
  </div>
);

export const ContentStudioView = ({ keywords }: ContentStudioViewProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('ideas');
  const [selectedIdea, setSelectedIdea] = useState<ContentIdea | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingIdea, setPendingIdea] = useState<ContentIdea | null>(null);

  const {
    ideas,
    history,
    unviewedCount,
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

  const actionableIdeas = ideas.filter(idea => idea.actionable);
  const highPriorityCount = actionableIdeas.filter(i => i.priority === 'high').length;

  return (
    <div className="space-y-6">
      {activeTab === 'brief' ? null : (
        <Header loading={loading} onRefresh={handleRefresh} />
      )}

      <Tabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        highPriorityCount={highPriorityCount}
        unviewedCount={unviewedCount}
        historyLength={history.length}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {activeTab === 'ideas' && (
        <div className="space-y-4">
          <IdeasTabContent
            loading={loading}
            ideas={ideas}
            actionableIdeas={actionableIdeas}
            generating={generating}
            selectedIdea={selectedIdea}
            onCreateContent={handleCreateContent}
          />
          <NonActionableIdeas ideas={ideas} />
        </div>
      )}

      {activeTab === 'brief' && (
        <GroupBriefForm
          keywords={keywords}
          generating={generating}
          onGenerate={handleGenerateGroupBrief}
          onGenerateBatch={handleGenerateGroupBriefBatch}
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
          />
        </div>
      )}

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
