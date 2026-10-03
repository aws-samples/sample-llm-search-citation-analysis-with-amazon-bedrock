import type {
  ComponentType, ReactNode
} from 'react';
import type { ReportsOverviewResponse } from '../../../../api/reports';
import {
  GROUP_REPORT_DEFINITIONS, VISIBILITY_DEFINITIONS
} from '../../../../constants/kpiDefinitions';
import type { GroupKpiHistoryResponse } from '../../../../types/domain/groupKpiHistory';
import { KpiDefinitionsSection } from '../../layout';
import {
  gateGroupHistory, resolveKeyword, resolveRun
} from '../../BrandVisibilityReport/GroupKpiReport';
import { GroupKpiDriversSection } from '../../BrandVisibilityReport/sections/GroupKpiDriversSection';
import { GroupKpiHeadlineSection } from '../../BrandVisibilityReport/sections/GroupKpiHeadlineSection';
import { GroupKpiTrendSection } from '../../BrandVisibilityReport/sections/GroupKpiTrendSection';
import { KeywordRunsSection } from '../../BrandVisibilityReport/sections/KeywordRunsSection';
import { HeadlineSection as OverviewHeadlineSection } from '../../ExecutiveSummaryReport/sections/HeadlineSection';
import { NextActionsSection } from '../../ExecutiveSummaryReport/sections/NextActionsSection';
import { TrendSnapshotSection } from '../../ExecutiveSummaryReport/sections/TrendSnapshotSection';
import { WinsAndGapsSection } from '../../ExecutiveSummaryReport/sections/WinsAndGapsSection';
import type { GroupKpiSource } from '../reportSources';
import {
  EVERY_SCOPE, type DataBlockDefinition
} from './catalogTypes';

/** Blocks of the Executive Summary (`/reports/overview`), the keyword group KPIs and the KPI definitions. */

interface OverviewSectionProps {
  readonly data: ReportsOverviewResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** `[type, label, description, section]`; the type is what saved reports store. */
type OverviewBlockRow = readonly [string, string, string, ComponentType<OverviewSectionProps>];

const OVERVIEW_BLOCK_ROWS: readonly OverviewBlockRow[] = [
  ['executive_headline', 'Headline', 'Every KPI with its change, and the keywords by trend.', OverviewHeadlineSection],
  ['executive_trend', 'Trend and share of voice', 'The KPI lines and the share-of-voice donut.', TrendSnapshotSection],
  ['executive_wins_gaps', 'Top wins and gaps', 'The three keywords improving and declining the most.', WinsAndGapsSection],
  ['executive_next_actions', 'Next actions', 'The top three recommendations.', NextActionsSection],
];

const OVERVIEW_BLOCKS: readonly DataBlockDefinition[] = OVERVIEW_BLOCK_ROWS.map(([type, label, description, section]) => {
  const Section = section;
  return {
    type,
    category: 'executive',
    label,
    description,
    sources: ['overview'],
    scopes: ['all', 'group'],
    render: ({ overview }) => overview && <Section data={overview.data} loading={overview.loading} error={overview.error} />,
  };
});

interface GroupGateProps {
  readonly group: GroupKpiSource;
  readonly title: string;
  readonly children: (history: GroupKpiHistoryResponse) => ReactNode;
}

/** A group section once the group has a run in the period; its placeholder before. */
function GroupKpiGate({
  group, title, children
}: GroupGateProps) {
  const gate = gateGroupHistory({
    title,
    history: group.history.data,
    loading: group.history.loading,
    error: group.history.error,
    days: group.days,
  });
  return <>{gate.ready ? children(gate.value) : gate.placeholder}</>;
}

interface GroupBlockProps { readonly group: GroupKpiSource }

function GroupHeadlineBlock({ group }: GroupBlockProps) {
  return (
    <GroupKpiGate group={group} title="Headline">
      {(history) => (
        <GroupKpiHeadlineSection
          runs={history.runs}
          selected={resolveRun(history.runs, group.runTimestamp)}
          onSelect={group.selectRun}
          citationsConfigured={history.citations_configured}
        />
      )}
    </GroupKpiGate>
  );
}

function GroupEvolutionBlock({ group }: GroupBlockProps) {
  return (
    <GroupKpiGate group={group} title="KPI evolution">
      {(history) => (
        <GroupKpiTrendSection
          runs={history.runs}
          minCoverage={history.group_run_min_coverage}
          includePartial={group.includePartial}
          onIncludePartialChange={group.setIncludePartial}
        />
      )}
    </GroupKpiGate>
  );
}

function GroupDriversBlock({ group }: GroupBlockProps) {
  return (
    <GroupKpiGate group={group} title="What changed">
      {(history) => <GroupKpiDriversSection run={resolveRun(history.runs, group.runTimestamp)} />}
    </GroupKpiGate>
  );
}

function GroupKeywordsBlock({ group }: GroupBlockProps) {
  return (
    <GroupKpiGate group={group} title="Keyword detail">
      {(history) => {
        const selected = resolveKeyword(history.keywords, group.keyword);
        return selected && <KeywordRunsSection keywords={history.keywords} selected={selected} onSelect={group.selectKeyword} />;
      }}
    </GroupKpiGate>
  );
}

/** `[type, label, description, block]`; the type is what saved reports store. */
type GroupBlockRow = readonly [string, string, string, ComponentType<GroupBlockProps>];

const GROUP_BLOCK_ROWS: readonly GroupBlockRow[] = [
  ['group_headline', 'Headline', 'Every KPI of one run of the group, with its change.', GroupHeadlineBlock],
  ['group_kpi_evolution', 'KPI evolution', 'The KPIs of every run of the group over the period.', GroupEvolutionBlock],
  ['group_drivers', 'What changed', 'The keywords and brands behind the latest change.', GroupDriversBlock],
  ['group_keywords', 'Keyword detail', 'Every run of each keyword of the group.', GroupKeywordsBlock],
];

const GROUP_BLOCKS: readonly DataBlockDefinition[] = GROUP_BLOCK_ROWS.map(([type, label, description, block]) => {
  const Block = block;
  return {
    type,
    category: 'group_kpis',
    label,
    description,
    sources: ['groupKpis'],
    scopes: ['group'],
    render: ({ groupKpis }) => groupKpis && <Block group={groupKpis} />,
  };
});

const DEFINITION_BLOCKS: readonly DataBlockDefinition[] = [
  {
    type: 'group_definitions',
    category: 'group_kpis',
    label: 'How the group KPIs are measured',
    description: 'The definitions of the keyword group KPIs.',
    sources: [],
    scopes: EVERY_SCOPE,
    render: () => <KpiDefinitionsSection definitions={GROUP_REPORT_DEFINITIONS} />,
  },
  {
    type: 'kpi_definitions',
    category: 'reference',
    label: 'How these KPIs are measured',
    description: 'The definition of every visibility KPI, collapsed on screen and printed in full.',
    sources: [],
    scopes: EVERY_SCOPE,
    render: () => <KpiDefinitionsSection definitions={VISIBILITY_DEFINITIONS} />,
  },
];

export const SUMMARY_BLOCKS: readonly DataBlockDefinition[] = [...OVERVIEW_BLOCKS, ...GROUP_BLOCKS, ...DEFINITION_BLOCKS];
