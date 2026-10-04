import {
  createContext, useContext, useEffect, useState, type ComponentType, type ReactNode
} from 'react';
import type { CustomReportDays } from '../../../api/customReports';
import { useBrandConfig } from '../../../hooks/useBrandConfig';
import { useGroupKpiHistory } from '../../../hooks/useGroupKpiHistory';
import type { ReportScope } from '../../../types';
import type { GroupKpiHistoryResponse } from '../../../types/domain/groupKpiHistory';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';
import { useCompetitorGap } from '../CompetitorGapReport/useCompetitorGap';
import { useContentActionPlan } from '../ContentActionPlanReport/useContentActionPlan';
import { useExecutiveSummary } from '../ExecutiveSummaryReport/useExecutiveSummary';
import { useKeywordDeepDive } from '../KeywordDeepDiveReport/useKeywordDeepDive';
import { useReportReady } from '../layout/useReportReady';
import type { ReportSlice } from '../layout/sectionGate';
import {
  useScopeReportData, type ScopeReportData
} from '../scopeReport/useScopeReportData';

/**
 * The data a custom report renders from. Each source wraps the hook an
 * existing report already composes its sections with, and is mounted only
 * when one of the report's blocks needs it, so a source is fetched once
 * however many blocks read it, and not at all when none does.
 */

export type SourceId = 'scope' | 'overview' | 'groupKpis' | 'competitor' | 'contentPlan' | 'deepDive';

/** What the reader picked on the report page. */
interface ReportInputs {
  readonly scope: ReportScope;
  readonly days: CustomReportDays;
  /** The competitor in the URL; the first configured one when it names none or an unknown one. */
  readonly competitor: string | null;
}

/** `/reports/group-kpis` for a keyword group, with the run and keyword the reader picked. */
export interface GroupKpiSource {
  readonly history: ReportSlice<GroupKpiHistoryResponse>;
  readonly days: number;
  readonly runTimestamp: string | null;
  readonly selectRun: (timestamp: string) => void;
  readonly keyword: string | null;
  readonly selectKeyword: (keyword: string) => void;
  readonly includePartial: boolean;
  readonly setIncludePartial: (include: boolean) => void;
  readonly ready: boolean;
}

/** The configured competitors and the rollup of the one shown. */
export interface CompetitorSource {
  readonly competitors: readonly string[];
  readonly selected: string | null;
  readonly gap: ReturnType<typeof useCompetitorGap>;
  readonly ready: boolean;
}

type DeepDiveSource = ReturnType<typeof useKeywordDeepDive> & { readonly keyword: string };

export interface ReportSources {
  readonly inputs: ReportInputs;
  /** `/visibility` and `/trends` for the scope, as the scope reports read them. */
  readonly scope: ScopeReportData | null;
  /** `/reports/overview`, as the Executive Summary reads it (every keyword or a group). */
  readonly overview: ReturnType<typeof useExecutiveSummary> | null;
  readonly groupKpis: GroupKpiSource | null;
  readonly competitor: CompetitorSource | null;
  /** Citation gaps and Content Studio, as the Content Action Plan reads them (always every keyword). */
  readonly contentPlan: ReturnType<typeof useContentActionPlan> | null;
  /** Everything the Keyword Deep Dive reads for one keyword. */
  readonly deepDive: DeepDiveSource | null;
}

const ReportSourcesContext = createContext<ReportSources | null>(null);

export class ReportSourcesMissingError extends Error {
  constructor() {
    super('useReportSources must be called inside ReportSourcesProvider');
    this.name = 'ReportSourcesMissingError';
  }
}

export function useReportSources(): ReportSources {
  const sources = useContext(ReportSourcesContext);
  if (sources === null) throw new ReportSourcesMissingError();
  return sources;
}

interface LayerProps {
  readonly patch: Partial<ReportSources>;
  readonly children: ReactNode;
}

/** Adds one source to the ones the layers above provide. */
function SourceLayer({
  patch, children
}: LayerProps) {
  const parent = useReportSources();
  return (
    <ReportSourcesContext.Provider value={{
      ...parent,
      ...patch,
    }}
    >
      {children}
    </ReportSourcesContext.Provider>
  );
}

interface SourceProps {
  readonly inputs: ReportInputs;
  readonly children: ReactNode;
}

function ScopeSource({
  inputs, children
}: SourceProps) {
  const scope = useScopeReportData(inputs.scope, inputs.days);
  return <SourceLayer patch={{ scope }}>{children}</SourceLayer>;
}

function OverviewSource({
  inputs, children
}: SourceProps) {
  const overview = useExecutiveSummary(inputs.days, inputs.scope);
  return <SourceLayer patch={{ overview }}>{children}</SourceLayer>;
}

function GroupKpiSourceLayer({
  inputs, children
}: SourceProps) {
  const history = useGroupKpiHistory();
  const { fetchGroupKpiHistory } = history;
  const scopeKey = encodeReportScope(inputs.scope);
  const [runTimestamp, selectRun] = useState<string | null>(null);
  const [keyword, selectKeyword] = useState<string | null>(null);
  const [includePartial, setIncludePartial] = useState(false);

  useEffect(() => {
    fetchGroupKpiHistory(decodeReportScope(scopeKey), inputs.days);
  }, [scopeKey, inputs.days, fetchGroupKpiHistory]);

  const ready = useReportReady([history]);
  const groupKpis: GroupKpiSource = {
    history: {
      data: history.data,
      loading: history.loading,
      error: history.error,
    },
    days: inputs.days,
    runTimestamp,
    selectRun,
    keyword,
    selectKeyword,
    includePartial,
    setIncludePartial,
    ready,
  };
  return <SourceLayer patch={{ groupKpis }}>{children}</SourceLayer>;
}

/** The competitor asked for if it is configured, else the first configured one. */
export function pickCompetitor(competitors: readonly string[], requested: string | null): string | null {
  if (requested !== null && competitors.includes(requested)) return requested;
  return competitors[0] ?? null;
}

function CompetitorSourceLayer({
  inputs, children
}: SourceProps) {
  const {
    config, loading
  } = useBrandConfig();
  const competitors = loading ? [] : config.tracked_brands.competitors;
  const selected = pickCompetitor(competitors, inputs.competitor);
  const gap = useCompetitorGap(selected);
  const competitor: CompetitorSource = {
    competitors,
    selected,
    gap,
    ready: !loading && gap.ready,
  };
  return <SourceLayer patch={{ competitor }}>{children}</SourceLayer>;
}

function ContentPlanSource({ children }: SourceProps) {
  const contentPlan = useContentActionPlan();
  return <SourceLayer patch={{ contentPlan }}>{children}</SourceLayer>;
}

function DeepDiveSourceLayer({
  inputs, children
}: SourceProps) {
  const keyword = inputs.scope.kind === 'keyword' ? inputs.scope.keyword : null;
  const deepDive = useKeywordDeepDive(keyword);
  return (
    <SourceLayer patch={{
      deepDive: keyword === null ? null : {
        ...deepDive,
        keyword,
      },
    }}
    >
      {children}
    </SourceLayer>
  );
}

const SOURCE_COMPONENTS: Readonly<Record<SourceId, ComponentType<SourceProps>>> = {
  scope: ScopeSource,
  overview: OverviewSource,
  groupKpis: GroupKpiSourceLayer,
  competitor: CompetitorSourceLayer,
  contentPlan: ContentPlanSource,
  deepDive: DeepDiveSourceLayer,
};

/**
 * The nesting order. Sources that do not depend on the scope come first, so
 * a new scope, which can add or drop the scoped sources, never remounts and
 * refetches them.
 */
const SOURCE_ORDER: readonly SourceId[] = ['contentPlan', 'competitor', 'scope', 'overview', 'groupKpis', 'deepDive'];

interface ProviderProps {
  readonly sources: ReadonlySet<SourceId>;
  readonly inputs: ReportInputs;
  readonly children: ReactNode;
}

export function ReportSourcesProvider({
  sources, inputs, children
}: ProviderProps) {
  const base: ReportSources = {
    inputs,
    scope: null,
    overview: null,
    groupKpis: null,
    competitor: null,
    contentPlan: null,
    deepDive: null,
  };
  const tree = SOURCE_ORDER
    .filter((id) => sources.has(id))
    .reduceRight<ReactNode>((inner, id) => {
      const Source = SOURCE_COMPONENTS[id];
      return <Source key={id} inputs={inputs}>{inner}</Source>;
    }, children);
  return <ReportSourcesContext.Provider value={base}>{tree}</ReportSourcesContext.Provider>;
}

/** Every mounted source has settled: the page may print. */
export function sourcesReady(sources: ReportSources): boolean {
  return [sources.scope, sources.overview, sources.groupKpis, sources.competitor, sources.contentPlan, sources.deepDive]
    .every((source) => source === null || source.ready);
}
