import { useState } from 'react';
import { formatDate } from '../../../formatting/dateFormatter';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import {
  REGENERATE_FAILED_MESSAGE, REGENERATE_TIMEOUT_MESSAGE, useNarrativeRegeneration, type RegenerationPhase
} from '../../../hooks/useNarrativeRegeneration';
import type { ReportScope } from '../../../types';
import type {
  Insight, ReportInsightsResponse
} from '../../../types/domain/insights';
import type {
  InsightsNarrative, NarrativeInsight
} from '../../../types/domain/insightsNarrative';
import { decodeInsightsNarrative } from '../../../types/domain/insightsNarrativeDecoders';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Modal';
import {
  gateSection, ReportSection, SectionPlaceholder
} from '../layout';
import type { InsightsSectionProps } from './InsightsTableSection';
import { insightSentence } from './insightWording';

export const NARRATIVE_TITLE = 'Written insights';
export const NARRATIVE_EMPTY = 'No narrative has been written for this run yet. One is written after each complete run of a keyword group.';
export const REGENERATING_MESSAGE = 'Regenerating…';

interface Props extends InsightsSectionProps {
  /** The report's scope: only a keyword group has a narrative to regenerate. */
  readonly scope: ReportScope;
  /** The report period, sent with the poll so it reads the same payload the report does. */
  readonly days: number;
}

/** The computed insights an item cites, each read out with its numbers; an id no longer computed is shown as is. */
function CitedInsights({
  ids, insightsById
}: {
  readonly ids: readonly string[];
  readonly insightsById: ReadonlyMap<string, Insight>
}) {
  return (
    <ul aria-label="Based on" className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
      {ids.map((id) => {
        const insight = insightsById.get(id);
        return <li key={id}>Based on: {insight ? insightSentence(insight) : id}</li>;
      })}
    </ul>
  );
}

interface ItemListProps {
  readonly heading: string;
  readonly items: ReadonlyArray<NarrativeInsight & { readonly title?: string }>;
  readonly insightsById: ReadonlyMap<string, Insight>;
}

function NarrativeItems({
  heading, items, insightsById
}: ItemListProps) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="mt-4 mb-2 text-sm font-semibold text-gray-900 dark:text-white">{heading}</h3>
      <ol aria-label={heading} className="list-decimal space-y-3 pl-5 text-sm text-gray-800 dark:text-gray-200">
        {items.map((item) => (
          <li key={`${item.title ?? ''}${item.text}`}>
            {item.title && <p className="font-medium text-gray-900 dark:text-white">{item.title}</p>}
            <p>{item.text}</p>
            <CitedInsights ids={item.insight_ids} insightsById={insightsById} />
          </li>
        ))}
      </ol>
    </>
  );
}

/** Who wrote the narrative, for which run and when, and how many items the validator left out. */
function provenance(narrative: InsightsNarrative): string {
  const written = `Written by ${narrative.model ?? 'an unknown model'} on ${formatDate(narrative.generated_at)} for the run of ${formatDate(narrative.run_timestamp)}.`;
  if (narrative.dropped === 0) return written;
  const items = narrative.dropped === 1 ? '1 item was' : `${narrative.dropped} items were`;
  return `${written} ${items} left out for citing a number or an insight the facts do not hold.`;
}

function NarrativeContent({
  narrative, insights
}: {
  readonly narrative: InsightsNarrative;
  readonly insights: readonly Insight[]
}) {
  const insightsById = new Map(insights.map((insight) => [insight.id, insight]));
  return (
    <>
      <div lang={narrative.language}>
        <NarrativeItems heading="Insights" items={narrative.insights} insightsById={insightsById} />
        <NarrativeItems heading="Recommendations" items={narrative.recommendations} insightsById={insightsById} />
      </div>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">{provenance(narrative)}</p>
    </>
  );
}

const PHASE_MESSAGES: Readonly<Record<RegenerationPhase, string | null>> = {
  idle: null,
  regenerating: REGENERATING_MESSAGE,
  failed: REGENERATE_FAILED_MESSAGE,
  timed_out: REGENERATE_TIMEOUT_MESSAGE,
};

/** The admin's Regenerate button behind its confirmation, and where the request stands. */
function RegenerateControl({
  phase, onConfirm
}: {
  readonly phase: RegenerationPhase;
  readonly onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false);
  const message = PHASE_MESSAGES[phase];
  return (
    <div className="mb-3 flex items-center gap-3 print-hidden">
      <Button variant="secondary" size="sm" disabled={phase === 'regenerating'} onClick={() => setConfirming(true)}>
        Regenerate
      </Button>
      {message && <output className="text-xs text-gray-600 dark:text-gray-300">{message}</output>}
      <ConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onConfirm}
        title="Regenerate the narrative?"
        message="The narrative of this group's latest run is written again from its computed insights. The current one is replaced when the new one is ready."
        confirmText="Regenerate"
      />
    </div>
  );
}

function NarrativeBody({
  response, scope, days
}: {
  readonly response: ReportInsightsResponse;
  readonly scope: ReportScope;
  readonly days: number
}) {
  const stored = decodeInsightsNarrative(response.narrative);
  const { isAdmin } = useIsAdmin();
  const regeneration = useNarrativeRegeneration(scope, days, stored?.generated_at ?? null);
  const narrative = regeneration.narrative ?? stored;
  return (
    <ReportSection
      title={NARRATIVE_TITLE}
      subtitle="Insights and recommendations written by AI from the computed insights and KPIs only; each names the insights it rests on."
    >
      {isAdmin && scope.kind === 'group' && (
        <RegenerateControl phase={regeneration.phase} onConfirm={() => void regeneration.regenerate()} />
      )}
      {narrative
        ? <NarrativeContent narrative={narrative} insights={response.insights} />
        : <SectionPlaceholder variant="empty" message={NARRATIVE_EMPTY} />}
    </ReportSection>
  );
}

/**
 * The stored narrative of the scope's latest run: up to three insights and
 * six recommendations, each followed by the computed insights it cites, and
 * who wrote it when. An admin can regenerate a group's narrative; the
 * section then polls until the new one is stored.
 */
export function NarrativeSection({
  scope, days, data, loading, error
}: Props) {
  const gate = gateSection({
    title: NARRATIVE_TITLE,
    loading,
    error,
    loadingMessage: 'Loading insights…',
    value: data,
  });
  if (!gate.ready) return gate.placeholder;
  return <NarrativeBody response={gate.value} scope={scope} days={days} />;
}
