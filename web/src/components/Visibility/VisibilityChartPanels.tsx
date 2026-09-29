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

export const ENGINES_TITLE = 'AI engines';
export const ENGINES_INFO = 'The KPIs over each AI engine\'s answers alone. The chart compares the mention rate, '
  + 'visibility score and citation rate on a 0–100 scale; the table adds the other KPIs, and the Excel export every one.';
export const SOURCES_TITLE = 'Top cited domains';
export const SOURCES_INFO = 'The domains the answers cite most, by the answers citing each. Your own domains are marked owned.';

/** Each brand's share of all brand mentions in the scope's latest runs. */
export function BrandShareOfVoicePanel({ brands }: { readonly brands: readonly BrandLeaderboardRow[] }) {
  return (
    <OverviewPanel title="Share of voice" info={KPI_DEFINITIONS.share_of_voice.definition}>
      <ShareOfVoiceChart brands={brands} />
    </OverviewPanel>
  );
}

/** The KPIs of each AI engine as grouped bars, then all of them in a table. */
export function EnginesPanel({ engines }: { readonly engines: readonly EngineKpis[] }) {
  return (
    <OverviewPanel title={ENGINES_TITLE} info={ENGINES_INFO}>
      <EngineKpiChart engines={engines} />
      {engines.length > 0 && <EngineKpiTable engines={engines} />}
    </OverviewPanel>
  );
}

/** "3 of 5 cited domains, most cited first." */
function sourcesNote(listed: number, total: number): string {
  return `${listed} of ${total} cited domain${total === 1 ? '' : 's'}, most cited first.`;
}

/** The ten most cited domains as bars, then every listed domain in a table. */
export function SourcesPanel({
  sources, total
}: {
  readonly sources: readonly SourceRow[];
  /** Every domain the answers cite, listed or not. */
  readonly total: number;
}) {
  return (
    <OverviewPanel title={SOURCES_TITLE} info={SOURCES_INFO}>
      <TopSourcesChart sources={sources} />
      {sources.length > 0 && (
        <>
          <TopDomainsTable sources={sources} />
          <p className="text-xs text-gray-500">{sourcesNote(sources.length, total)}</p>
        </>
      )}
    </OverviewPanel>
  );
}
