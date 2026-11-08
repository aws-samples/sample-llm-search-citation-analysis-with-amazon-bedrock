import { useMemo } from 'react';
import type {
  CompetitorExclusiveSource, CompetitorReportResponse
} from '../../../../api/reports';
import {
  PriorityBadge, REPORT_CARD_CLASS, ReportCardHeader, ReportSection, ReportSectionNote
} from '../../layout';
import {
  gateRollup, type RollupSectionProps
} from './rollupSection';
import { useScopedList } from '../../../../hooks/useScopedList';
import {
  isOutreachTarget, OUTREACH_TARGETS_PAGING
} from '../../../../api/scopedListPagings';
import { ScopedListFooter } from '../../../ui/ScopedListFooter';

const TITLE = 'Top outreach targets';

/** The answer with its outreach total, `exclusive_source_count` when the server sends no `outreach_targets_total`. */
function withOutreachTotal(response: CompetitorReportResponse | null): CompetitorReportResponse | null {
  if (response === null) return null;
  const { rollup } = response;
  return {
    ...response,
    rollup: {
      ...rollup,
      outreach_targets_total: rollup.outreach_targets_total ?? rollup.exclusive_source_count,
    },
  };
}

/**
 * Outreach targets — the prioritised list of sources that cite this
 * competitor but not first-party brands. The lift score is already
 * computed server-side; we just render it. Top targets get their own
 * page because each card is meaty (URL, domain, providers) and
 * pagination across them is what the strategist will pin to a wall.
 * The first page opens the list; "Load more" pages through every exclusive
 * source (2.45.0 wave 5, `view=outreach`).
 */
export function OutreachTargetsSection(props: RollupSectionProps) {
  const body = useMemo(() => withOutreachTotal(props.response ?? null), [props.response]);
  const targetList = useScopedList(body, props.request ?? null, OUTREACH_TARGETS_PAGING, isOutreachTarget);
  const gate = gateRollup(TITLE, props);
  if (!gate.ready) return gate.placeholder;

  // An older answer carries no `response`: the rollup's own list is the whole list.
  const targets = body === null ? gate.value.outreach_targets : targetList.items;
  if (targets.length === 0) {
    return (
      <ReportSectionNote title={TITLE} subtitle="No outreach targets identified.">
        Either no sources cite this competitor without first-party
        coverage, or the citation-gap analysis hasn&apos;t run yet.
      </ReportSectionNote>
    );
  }

  return (
    <ReportSection
      title={TITLE}
      subtitle="Sources to pitch first. Lift = provider coverage scaled by citation count. Higher lift means a single placement moves more keywords."
      startNewPage
    >
      <div className="space-y-3">
        {targets.map((target) => (
          <TargetCard key={`${target.url}::${target.keyword}`} target={target} />
        ))}
      </div>
      <ScopedListFooter list={targetList} noun="sources" />
    </ReportSection>
  );
}

function TargetCard({ target }: { readonly target: CompetitorExclusiveSource }) {
  return (
    <div className={REPORT_CARD_CLASS}>
      <ReportCardHeader
        title={target.domain}
        detail={(
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {target.url}
          </p>
        )}
        aside={<PriorityBadge priority={target.priority} />}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
        <TargetFigure label="Lift" value={target.lift_score.toFixed(2)} />
        <TargetFigure label="Citations" value={target.citation_count.toString()} />
        <TargetFigure label="Providers" value={target.provider_count.toString()} />
        <TargetFigure label="Keyword" value={target.keyword} />
      </div>
    </div>
  );
}

function TargetFigure({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-gray-900 dark:text-white mt-0.5 truncate">{value}</p>
    </div>
  );
}
