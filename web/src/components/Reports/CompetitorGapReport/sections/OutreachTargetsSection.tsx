import type { CompetitorExclusiveSource } from '../../../../api/reports';
import {
  PriorityBadge, REPORT_CARD_CLASS, ReportCardHeader, ReportSection, ReportSectionNote
} from '../../layout';
import {
  gateRollup, type RollupSectionProps
} from './rollupSection';

const TITLE = 'Top outreach targets';

/**
 * Outreach targets — the prioritised list of sources that cite this
 * competitor but not first-party brands. The lift score is already
 * computed server-side; we just render it. Top targets get their own
 * page because each card is meaty (URL, domain, providers) and
 * pagination across them is what the strategist will pin to a wall.
 */
export function OutreachTargetsSection(props: RollupSectionProps) {
  const gate = gateRollup(TITLE, props);
  if (!gate.ready) return gate.placeholder;

  const targets = gate.value.outreach_targets;
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
