import {
  useEffect, useState 
} from 'react';
import { usePromptInsights } from '../../hooks/usePromptInsights';
import { PromptCard } from './PromptCard';
import { PageHeaderCard } from '../ui/PageHeaderCard';

const TABS = [
  {
    id: 'winning',
    label: 'Winning',
    color: 'green' 
  },
  {
    id: 'losing',
    label: 'Losing',
    color: 'red' 
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    color: 'yellow' 
  }
] as const;

type TabId = typeof TABS[number]['id'];

export function PromptInsights() {
  const [activeTab, setActiveTab] = useState<TabId>('winning');
  const {
    data, loading, error, fetchPromptInsights 
  } = usePromptInsights();

  useEffect(() => {
    fetchPromptInsights('all', 20);
  }, [fetchPromptInsights]);

  const getPrompts = () => {
    if (!data) return [];
    const map = {
      winning: data.winning_prompts,
      losing: data.losing_prompts,
      opportunities: data.opportunity_prompts 
    };
    return map[activeTab] ?? [];
  };

  const getCount = (id: TabId) => {
    if (!data) return 0;
    const map = {
      winning: data.summary.winning_count,
      losing: data.summary.losing_count,
      opportunities: data.summary.opportunity_count 
    };
    return map[id] ?? 0;
  };

  const prompts = getPrompts();

  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Prompt Insights"
        description={(
          <>
            Understand which search queries work in your favor. "Winning" = top 3 rank. 
            "Losing" = low visibility. "Opportunities" = competitors appear but you don't.
          </>
        )}
      >
        {data && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 text-center self-start">
            <div className="text-2xl sm:text-3xl font-bold text-green-600">{data.summary.win_rate}%</div>
            <div className="text-xs text-green-700 font-medium mt-1">Win Rate</div>
          </div>
        )}
      </PageHeaderCard>

      {data && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {([
            ['Winning', 'border-green-500', 'text-green-600', data.summary.winning_count],
            ['Losing', 'border-red-500', 'text-red-600', data.summary.losing_count],
            ['Opportunities', 'border-yellow-500', 'text-yellow-600', data.summary.opportunity_count],
          ] as const).map(([label, borderClass, countClass, count]) => (
            <div key={label} className={`bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 ${borderClass}`}>
              <div className="text-xs sm:text-sm text-gray-500">{label}</div>
              <div className={`text-xl sm:text-2xl font-bold ${countClass}`}>{count}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-2 sm:gap-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 text-sm font-medium ${
                activeTab === tab.id
                  ? `border-${tab.color}-500 text-${tab.color}-600`
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label} ({getCount(tab.id)})
            </button>
          ))}
        </nav>
      </div>

      {loading && <div className="text-center py-8 text-gray-500">Loading insights...</div>}
      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {prompts.map(prompt => <PromptCard key={prompt.keyword} prompt={prompt} />)}
      </div>

      {prompts.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          No {activeTab} prompts found. Run more analyses to gather data.
        </div>
      )}
    </div>
  );
}

