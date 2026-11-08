import {
  useEffect, useId, useState
} from 'react';
import { usePromptInsights } from '../../hooks/usePromptInsights';
import { ComputingState } from '../ui/ComputingState';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { ExportAllButton } from '../ui/ExportAllButton';
import { requestParams } from '../../api/exports';
import type { ScopedList } from '../../hooks/useScopedList';
import type {
  Keyword, PromptInsight
} from '../../types';
import { PromptCard } from './PromptCard';
import { usePromptTabList } from './usePromptTabList';
import { InsightsScopeSelector } from './InsightsScopeSelector';
import { useScopeSelection } from './useScopeSelection';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';
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
    activeClassName: 'border-green-500 text-green-600',
  },
  {
    id: 'losing',
    label: 'Losing',
    activeClassName: 'border-red-500 text-red-600',
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    activeClassName: 'border-yellow-500 text-yellow-600',
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
    <div className="bg-linear-to-br/srgb from-green-50 to-emerald-50 rounded-xl p-4 text-center self-start">
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
        <div key={label} className={`bg-white p-3 sm:p-4 rounded-lg shadow-sm border-l-4 ${borderClass}`}>
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
    data, loading, error, computing, request, fetchPromptInsights
  } = usePromptInsights(selection.scope);
  const pending = loading || selection.scopePending;
  // Only an answer for the selected scope is shown; while one is in flight, nothing is.
  const insights = pending ? null : data;
  const list = usePromptTabList(insights, request, activeTab);

  useEffect(
    () => selection.trackScopeRequest(fetchPromptInsights('all', 20)),
    [fetchPromptInsights, selection.trackScopeRequest],
  );

  const getCount = (id: TabId) => {
    if (!insights) return 0;
    const map = {
      winning: insights.summary.winning_count,
      losing: insights.summary.losing_count,
      opportunities: insights.summary.opportunity_count 
    };
    return map[id] ?? 0;
  };

  const panelId = useId();
  const tabs = TABS.map((tab) => ({
    ...tab,
    label: (
      <>
        {/* A fixed-width count slot, so the tabs keep their place when the counts arrive. */}
        {tab.label} (<span className="inline-block min-w-6 text-center tabular-nums">
          {pending ? <CountSkeleton /> : getCount(tab.id)}
        </span>)
      </>
    ),
  }));

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
        <div>
          <ExportAllButton view="prompt-insights" params={pending ? null : requestParams(request)} />
        </div>
      </PageHeaderCard>

      <SummaryTiles insights={insights} pending={pending} />
      <ScopeCoverageNote response={insights} />

      <TabBar tabs={tabs} activeId={activeTab} onChange={setActiveTab} label="Prompt outcomes" panelId={panelId} />

      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      <TabPanel id={panelId} activeId={activeTab}>
        <PromptTabBody pending={pending} computing={computing !== null} list={list} tab={activeTab} />
      </TabPanel>
    </div>
  );
}

/** One tab's prompt cards with their paging footer, or the computing/loading placeholder. */
function PromptTabBody({
  pending, computing, list, tab
}: {
  readonly pending: boolean;
  /** A view job computes the answer. */
  readonly computing: boolean;
  readonly list: ScopedList<PromptInsight>;
  readonly tab: TabId;
}) {
  if (pending && computing) return <ComputingState subject="prompt insights" />;
  if (pending) {
    return (
      <SkeletonRegion label="Loading insights">
        <InsightCardGridSkeleton cardClassName="h-[153px]" />
      </SkeletonRegion>
    );
  }
  if (list.items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No {tab} prompts found. Run more analyses to gather data.
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.items.map(prompt => <PromptCard key={prompt.keyword} prompt={prompt} />)}
      </div>
      <ScopedListFooter list={list} noun={`${tab === 'opportunities' ? 'opportunity' : tab} prompts`} label="Load more prompts" />
    </>
  );
}
