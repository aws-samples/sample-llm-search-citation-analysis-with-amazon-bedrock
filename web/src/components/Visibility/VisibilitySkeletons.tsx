import type { ReactNode } from 'react';
import { KPI_IDS } from '../../constants/kpiDefinitions';
import {
  Skeleton, SkeletonRegion, SkeletonTable
} from '../ui/Skeleton';

/*
 * Placeholders for the Visibility tab, each shaped like the panel it stands in
 * for (an `OverviewPanel`: white card, `text-lg` heading, `space-y-3` body),
 * so the data lands without moving the page.
 */

const INSIGHT_ROW_IDS = ['insight-a', 'insight-b', 'insight-c'] as const;
const HEADLINE_CARD_IDS = ['mention-rate', 'share-of-voice', 'visibility-score', 'citation-rate'] as const;

/** An `OverviewPanel` frame with a heading-sized bar. */
const PanelSkeleton = ({ children }: { readonly children: ReactNode }) => (
  <div className="bg-white rounded-lg shadow p-4 space-y-3">
    <div className="flex h-7 items-center"><Skeleton className="h-5 w-32" /></div>
    {children}
  </div>
);

/** The three insight lines of `InsightsSummary`, each a severity badge and a sentence. */
export const InsightsSummarySkeleton = () => (
  <SkeletonRegion label="Loading insights" className="space-y-2">
    {INSIGHT_ROW_IDS.map((id) => (
      <div key={id} className="flex h-5 items-center gap-2">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-3.5 flex-1" />
      </div>
    ))}
  </SkeletonRegion>
);

/** The history chart and its caption, while the trends of a new range or scope load. */
export const HistoryChartSkeleton = () => (
  <SkeletonRegion label="Loading history" className="space-y-3">
    <Skeleton className="h-72 w-full rounded-lg" />
    <Skeleton className="h-3 w-2/3" />
  </SkeletonRegion>
);

/**
 * `VisibilityOverview` before the first answer: the scope summary line, the
 * Headline panel (four KPI cards over the table of every KPI) and the History
 * panel. The panels further down start below the fold, so they are left out.
 */
export const VisibilityOverviewSkeleton = () => (
  <SkeletonRegion label="Loading visibility data" className="space-y-6">
    <div className="flex items-center justify-between gap-3">
      <Skeleton className="h-3.5 w-96 max-w-full" />
      <Skeleton className="h-[34px] w-32 rounded-lg" />
    </div>
    <PanelSkeleton>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {HEADLINE_CARD_IDS.map((id) => <Skeleton key={id} className="h-[110px] rounded-lg" />)}
      </div>
      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
        <div className="h-8 bg-gray-50" />
        <SkeletonTable rows={KPI_IDS.length} columns={4} rowClassName="h-[37px]" />
      </div>
    </PanelSkeleton>
    <PanelSkeleton>
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-3 w-2/3" />
    </PanelSkeleton>
  </SkeletonRegion>
);
