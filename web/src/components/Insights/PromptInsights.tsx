import {
  useEffect, useState 
} from 'react';
import { usePromptInsights } from '../../hooks/usePromptInsights';
import type { Keyword } from '../../types';
import { PromptCard } from './PromptCard';
import { InsightsScopeSelector } from './InsightsScopeSelector';
import { useScopeSelection } from './useScopeSelection';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';
import {
  CountSkeleton, InsightCardGridSkeleton, StatTilesSkeleton
} from './InsightsSkeletons';

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

type Insights = NonNullable<ReturnType<typeof usePromptInsights>['data']>;

interface InsightsSlotProps {
  readonly insights: Insights | null;
  readonly pending: boolean;
}

/** The win-rate badge, or a box of its size while the answer is in flight. */
function WinRateBadge({
  insights, pending
}: InsightsSlotProps) {
  if (pending) return <Skeleton className="h-[84px] sm:h-[88px] w-24 rounded-xl self-start" />;
  if (!insights) return null;
  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 text-center self-start">
      <div className="text-2xl sm:text-3xl font-bold text-green-600">{insights.summary.win_rate}%</div>
      <div className="text-xs text-green-700 font-medium mt-1">Win Rate</div>
    </div>
  );
}

/** The three count tiles over the tabs, or tiles of their size while the answer is in flight. */
function SummaryTiles({
  insights, pending
}: InsightsSlotProps) {
  if (pending) return <StatTilesSkeleton count={3} gridClassName="grid-cols-3" />;
  if (!insights) return null;
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {([
        ['Winning', 'border-green-500', 'text-green-600', insights.summary.winning_count],
        ['Losing', 'border-red-500', 'text-red-600', insights.summary.losing_count],
        ['Opportunities', 'border-yellow-500', 'text-yellow-600', insights.summary.opportunity_count],
      ] as const).map(([label, borderClass, countClass, count]) => (
        <div key={label} className={`bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 ${borderClass}`}>
          <div className="text-xs sm:text-sm text-gray-500">{label}</div>
          <div className={`text-xl sm:text-2xl font-bold ${countClass}`}>{count}</div>
        </div>
      ))}
    </div>
  );
}

interface Props { readonly keywords: Array<Keyword>; }

export function PromptInsights({ keywords }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('winning');
  const selection = useScopeSelection();
  const {
    data, loading, error, fetchPromptInsights 
  } = usePromptInsights(selection.scope);
  const pending = loading || selection.scopePending;
  // Only an answer for the selected scope is shown; while one is in flight, nothing is.
  const insights = pending ? null : data;

  useEffect(
    () => selection.trackScopeRequest(fetchPromptInsights('all', 20)),
    [fetchPromptInsights, selection.trackScopeRequest],
  );

  const getPrompts = () => {
    if (!insights) return [];
    const map = {
      winning: insights.winning_prompts,
      losing: insights.losing_prompts,
      opportunities: insights.opportunity_prompts 
    };
    return map[activeTab] ?? [];
  };

  const getCount = (id: TabId) => {
    if (!insights) return 0;
    const map = {
      winning: insights.summary.winning_count,
      losing: insights.summary.losing_count,
      opportunities: insights.summary.opportunity_count 
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
        <InsightsScopeSelector keywords={keywords} selection={selection} label="Analyze" />
        <WinRateBadge insights={insights} pending={pending} />
      </PageHeaderCard>

      <SummaryTiles insights={insights} pending={pending} />

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
              {/* A fixed-width count slot, so the tabs keep their place when the counts arrive. */}
              {tab.label} (<span className="inline-block min-w-[1.5rem] text-center tabular-nums">
                {pending ? <CountSkeleton /> : getCount(tab.id)}
              </span>)
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      {pending ? (
        <SkeletonRegion label="Loading insights">
          <InsightCardGridSkeleton cardClassName="h-[153px]" />
        </SkeletonRegion>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {prompts.map(prompt => <PromptCard key={prompt.keyword} prompt={prompt} />)}
        </div>
      )}

      {prompts.length === 0 && !pending && (
        <div className="text-center py-8 text-gray-500">
          No {activeTab} prompts found. Run more analyses to gather data.
        </div>
      )}
    </div>
  );
}
