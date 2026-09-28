import { useId } from 'react';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  formatKpi, formatKpiDelta
} from '../../../../formatting/kpiFormatter';
import {
  KPI_DEFINITIONS, KPI_SPECS, type KpiId, type KpiSpec
} from '../../../../constants/kpiDefinitions';
import { InfoTooltip } from '../../../ui/InfoTooltip';
import {
  ReportSection, ReportStatCard, ReportStatGrid, ReportTable, type ReportTableColumn
} from '../../layout';
import {
  runTrend, trendAccent
} from '../groupKpiView';

interface Props {
  /** Every run in the window, oldest first. */
  readonly runs: readonly GroupRun[];
  readonly selected: GroupRun;
  readonly onSelect: (timestamp: string) => void;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  readonly citationsConfigured: boolean;
}

/** The four KPIs on the headline cards; every KPI is in the table below them. */
const HEADLINE_KPIS: readonly KpiId[] = ['mention_rate', 'share_of_voice', 'visibility_score', 'citation_rate'];

const TREND_LABELS = {
  improving: 'Improving',
  declining: 'Declining',
  stable: 'Stable',
} as const;

const OWNED_DOMAINS_MISSING = 'Set owned domains in Settings › Brand Tracking to measure citations';

function changeFootnote(run: GroupRun, id: KpiId): string {
  if (run.change === null) return 'No earlier group run to compare with';
  return `${formatKpiDelta(id, run.change.deltas[id])} since ${formatDate(run.change.previous_timestamp)}`;
}

function runOptionLabel(run: GroupRun): string {
  const partial = run.is_group_run ? '' : ' (partial)';
  return `${formatDate(run.timestamp)} · ${run.keywords_with_data}/${run.keywords_total} keywords${partial}`;
}

function kpiTableColumns(run: GroupRun): ReadonlyArray<ReportTableColumn<KpiSpec>> {
  return [
    {
      header: 'KPI',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'whitespace-nowrap font-medium',
      render: (spec) => (
        <>
          {spec.label}
          <InfoTooltip label={spec.label} text={spec.definition} />
        </>
      ),
    },
    {
      header: 'Value',
      render: (spec) => formatKpi(spec.id, run.kpis[spec.id]),
    },
    {
      header: 'Change',
      render: (spec) => (run.change === null ? '—' : formatKpiDelta(spec.id, run.change.deltas[spec.id])),
    },
    {
      header: 'Trend',
      render: (spec) => {
        const trend = runTrend(run, spec.id);
        return trend === undefined ? '—' : TREND_LABELS[trend];
      },
    },
  ];
}

/**
 * The group's KPIs for one run (the latest group run by default): four
 * headline cards, then every KPI with its change and trend since the
 * previous group run, each with a tooltip saying how it is measured.
 */
export function GroupKpiHeadlineSection({
  runs, selected, onSelect, citationsConfigured
}: Props) {
  const pickerId = useId();
  const { kpis } = selected;

  return (
    <ReportSection
      title="Headline"
      subtitle={`Run of ${formatDate(selected.timestamp)} — ${kpis.answers ?? 0} AI answers from ${kpis.engines} engines `
        + `across ${selected.keywords_with_data} of ${selected.keywords_total} keywords.`}
    >
      <div className="mb-3 print-hidden">
        <label htmlFor={pickerId} className="mr-2 text-xs text-gray-600 dark:text-gray-300">Run</label>
        <select
          id={pickerId}
          value={selected.timestamp}
          onChange={(event) => onSelect(event.target.value)}
          className="rounded-lg border border-gray-200 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
        >
          {[...runs].reverse().map((run) => (
            <option key={run.timestamp} value={run.timestamp}>{runOptionLabel(run)}</option>
          ))}
        </select>
      </div>
      <ReportStatGrid columns={4}>
        {HEADLINE_KPIS.map((id) => (
          <ReportStatCard
            key={id}
            label={KPI_DEFINITIONS[id].label}
            value={formatKpi(id, kpis[id])}
            footnote={id === 'citation_rate' && !citationsConfigured ? OWNED_DOMAINS_MISSING : changeFootnote(selected, id)}
            accent={trendAccent(runTrend(selected, id))}
            info={KPI_DEFINITIONS[id].definition}
          />
        ))}
      </ReportStatGrid>
      <div className="mt-4">
        {
          // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
          <ReportTable columns={kpiTableColumns(selected)} rows={KPI_SPECS} rowKey={(spec) => spec.id} />
        }
      </div>
    </ReportSection>
  );
}
