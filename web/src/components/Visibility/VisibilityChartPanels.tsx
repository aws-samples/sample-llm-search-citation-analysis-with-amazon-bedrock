import type { ReactNode } from 'react';
import type {
  BrandLeaderboardRow, EngineKpis, SourceRow
} from '../../types';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';
import {
  EngineKpiChart, ShareOfVoiceChart, TopSourcesChart
} from '../Reports/charts';
import { EngineKpiTable } from '../Reports/layout/EngineKpiTable';
import { OverviewPanel } from './OverviewPanel';
import { TopDomainsTable } from './TopDomainsTable';
import { BRAND_LEADERBOARD_ANCHOR } from './BrandLeaderboard';

export const ENGINES_TITLE = 'AI engines';
const ENGINES_INFO = 'The KPIs over each AI engine\'s answers alone. The chart compares the mention rate, '
  + 'visibility score and citation rate on a 0–100 scale; the table adds the other KPIs, and Export all every one.';
export const SOURCES_TITLE = 'Top cited domains';
const SOURCES_INFO = 'The domains the answers cite most, by the answers citing each. Your own domains are marked owned.';

/** Each brand's share of all brand mentions in the scope's latest runs; the chart keeps the top brands, the leaderboard has them all. */
export function BrandShareOfVoicePanel({ brands }: { readonly brands: readonly BrandLeaderboardRow[] }) {
  return (
    <OverviewPanel
      title="Share of voice"
      info={KPI_DEFINITIONS.share_of_voice.definition}
      actions={brands.length > 0 ? <a href={`#${BRAND_LEADERBOARD_ANCHOR}`} className="print-hidden text-sm font-medium text-gray-700 underline hover:text-gray-900">See all brands</a> : undefined}
    >
      <ShareOfVoiceChart brands={brands} />
    </OverviewPanel>
  );
}

/** The KPIs of each AI engine as grouped bars, then all of them in a table. */
export function EnginesPanel({
  engines, actions
}: {
  readonly engines: readonly EngineKpis[];
  /** At the heading's right: the engines' Export all. */
  readonly actions?: ReactNode;
}) {
  return (
    <OverviewPanel title={ENGINES_TITLE} info={ENGINES_INFO} actions={actions}>
      <EngineKpiChart engines={engines} />
      {engines.length > 0 && <EngineKpiTable engines={engines} />}
    </OverviewPanel>
  );
}

/** The ten most cited domains as bars, then every loaded domain in a table with the list's paging footer. */
export function SourcesPanel({
  sources, footer, actions
}: {
  readonly sources: readonly SourceRow[];
  /** Below the table: "Showing N of M cited domains" and Load more (`ScopedListFooter`). */
  readonly footer?: ReactNode;
  /** At the heading's right: the domains' Export all. */
  readonly actions?: ReactNode;
}) {
  return (
    <OverviewPanel title={SOURCES_TITLE} info={SOURCES_INFO} actions={actions}>
      <TopSourcesChart sources={sources} />
      {sources.length > 0 && <TopDomainsTable sources={sources} />}
      {footer}
    </OverviewPanel>
  );
}
