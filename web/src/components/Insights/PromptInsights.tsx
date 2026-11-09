import {
  useEffect, useId, useState
} from 'react';
import { usePromptInsights } from '../../hooks/usePromptInsights';
import type { Keyword } from '../../types';
import { PromptCard } from './PromptCard';
import { InsightsPageHeader } from './InsightsScopeSelector';
import { useScopeSelection } from './useScopeSelection';
import { SkeletonRegion } from '../ui/Skeleton';
import {
  TabBar, TabPanel
} from '../ui/TabBar';
import {
  CountSkeleton, InsightCardGridSkeleton, StatTilesSkeleton
} from './InsightsSkeletons';

/** Each tab is underlined in the colour of its summary tile. */
const TABS = [
  {
    id: 'winning',
    label: 'Winning',
    activeClassName: 'border-green-500 text-emerald-700',
  },
  {
    id: 'losing',
    label: 'Losing',
    activeClassName: 'border-red-500 text-red-600',
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    activeClassName: 'border-amber-500 text-amber-700',
  }
] as const;

type TabId = typeof TABS[number]['id'];

type Insights = NonNullable<ReturnType<typeof usePromptInsights>['data']>;

interface InsightsSlotProps {
  readonly insights: Insights | null;
  readonly pending: boolean;
}

/** The win rate and the three count tiles over the tabs, or tiles of their size while the answer is in flight. */
function SummaryTiles({
  insights, pending
}: InsightsSlotProps) {
  if (pending) return <StatTilesSkeleton count={4} gridClassName="grid-cols-2 lg:grid-cols-4" />;
  if (!insights) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div className="bg-white p-3 sm:p-4 rounded-lg shadow border border-gray-200">
        <div className="text-xs sm:text-sm text-gray-500">Win Rate</div>
        <div className="text-xl sm:text-2xl font-bold text-gray-900">{insights.summary.win_rate}%</div>
      </div>
      {([
        ['Winning', 'text-emerald-700', insights.summary.winning_count],
        ['Losing', 'text-red-700', insights.summary.losing_count],
        ['Opportunities', 'text-amber-700', insights.summary.opportunity_count],
      ] as const).map(([label, countClass, count]) => (
        <div key={label} className="bg-white p-3 sm:p-4 rounded-lg shadow border border-gray-200">
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
  const panelId = useId();
  const tabs = TABS.map((tab) => ({
    ...tab,
    label: (
      <>
        {/* The count sits tight in its brackets; while loading a placeholder of about one digit holds its place. */}
        {tab.label} (<span className="tabular-nums">{pending ? <CountSkeleton /> : getCount(tab.id)}</span>)
      </>
    ),
  }));

  return (
    <div className="space-y-6">
      <InsightsPageHeader
        title="Prompt Insights"
        description={(
          <>
            Which queries work in your favor. Winning: your brand ranks in the top 3. Losing: your brand is
            seldom named. Opportunities: competitors are named and your brand is not.
          </>
        )}
        keywords={keywords}
        selection={selection}
      />

      <SummaryTiles insights={insights} pending={pending} />

      <TabBar tabs={tabs} activeId={activeTab} onChange={setActiveTab} label="Prompt outcomes" panelId={panelId} />

      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      <TabPanel id={panelId} activeId={activeTab}>
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
      </TabPanel>
    </div>
  );
}
