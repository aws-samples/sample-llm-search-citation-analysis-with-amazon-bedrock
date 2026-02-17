import {
  useState, useEffect
} from 'react';
import { useContentStudio } from '../../hooks/useContentStudio';
import { ContentIdeaCard } from './ContentIdeaCard';
import { ContentHistory } from './ContentHistory';
import { Spinner } from '../ui/Spinner';
import type { ContentIdea } from '../../types';

type TabType = 'ideas' | 'history';

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
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
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
            <svg className="w-5 h-5 text-amber-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
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
  idea: ContentIdea;
  onConfirm: (outputLanguage: string) => void;
  onCancel: () => void;
}

const COMMON_LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Dutch', 'Catalan', 'Japanese', 'Chinese', 'Korean', 'Arabic',
];

function ConfirmGenerateModal({
  idea, onConfirm, onCancel
}: ConfirmGenerateModalProps) {
  const [outputLanguage, setOutputLanguage] = useState('English');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-900/50 transition-opacity" onClick={onCancel} />

        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-orange-100 rounded-full">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
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
                  {COMMON_LANGUAGES.map(lang => (
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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Content
            </button>
          </div>
        </div>
      </div>
    </div>
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
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      Refresh
    </button>
  </div>
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
    <nav className="flex gap-8">
      <button
        onClick={() => setActiveTab('ideas')}
        className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
          activeTab === 'ideas'
            ? 'border-gray-900 text-gray-900'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        Content Ideas
        {highPriorityCount > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
            {highPriorityCount} high priority
          </span>
        )}
      </button>
      <button
        onClick={() => setActiveTab('history')}
        className={`pb-3 text-sm font-medium border-b-2 transition-colors relative ${
          activeTab === 'history'
            ? 'border-gray-900 text-gray-900'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
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
      </button>
    </nav>
  </div>
);

interface GeneratingIndicatorProps {keyword: string;}

const GeneratingIndicator = ({ keyword }: GeneratingIndicatorProps) => (
  <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
    <Spinner size="sm" />
    <div>
      <p className="text-sm font-medium">Generating content...</p>
      <p className="text-xs text-gray-300">&quot;{keyword}&quot;</p>
    </div>
  </div>
);

export const ContentStudioView = () => {
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
    fetchIdeas,
    generateContent,
    fetchHistory,
    markViewed,
    deleteContent
  } = useContentStudio();

  useEffect(() => {
    if (activeTab === 'ideas') {
      fetchIdeas();
    } else {
      fetchHistory();
    }
  }, [activeTab, fetchIdeas, fetchHistory]);

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
    };
    setSelectedIdea(ideaWithLanguage);

    const result = await generateContent(ideaWithLanguage);

    if (result?.success) {
      setActiveTab('history');
      setSelectedIdea(null);
    }

    setPendingIdea(null);
  };

  const handleCancelGenerate = () => {
    setShowConfirmModal(false);
    setPendingIdea(null);
  };

  const handleRefresh = () => {
    if (activeTab === 'ideas') {
      fetchIdeas();
    } else {
      fetchHistory();
    }
  };

  const actionableIdeas = ideas.filter(idea => idea.actionable);
  const highPriorityCount = actionableIdeas.filter(i => i.priority === 'high').length;

  return (
    <div className="space-y-6">
      <Header loading={loading} onRefresh={handleRefresh} />

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

      {activeTab === 'history' && (
        <ContentHistory
          history={history}
          loading={loading}
          onDelete={deleteContent}
          onMarkViewed={markViewed}
        />
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
