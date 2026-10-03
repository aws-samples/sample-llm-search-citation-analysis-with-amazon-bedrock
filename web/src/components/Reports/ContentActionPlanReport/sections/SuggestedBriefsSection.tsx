import type { ContentIdea } from '../../../../types';
import {
  PriorityBadge,
  REPORT_CARD_CLASS,
  ReportSection,
  ReportSectionNote,
  pendingSectionPlaceholder,
  type SectionFetchState,
} from '../../layout';

interface Props extends SectionFetchState {readonly ideas: ReadonlyArray<ContentIdea>;}

const TITLE = 'Suggested next briefs';
const MAX_IDEAS = 10;
const PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2 
} as const;

/**
 * The "queue" — content ideas surfaced by the Content Studio engine that
 * haven't been turned into briefs yet. Ordered by priority so a strategist
 * can pick the next thing to generate.
 *
 * Each card shows the angle (comprehensive guide / differentiation / etc.)
 * because the angle changes who you'd assign the work to and how long it
 * will take. Persona-targeted ideas surface their persona for the same
 * reason.
 */
export function SuggestedBriefsSection({
  ideas, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: TITLE,
    loading,
    loadingMessage: 'Loading content ideas…',
    error,
  });
  if (pending) return pending;

  const sorted = [...ideas]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_IDEAS);

  if (sorted.length === 0) {
    return (
      <ReportSectionNote title={TITLE} subtitle="No open content ideas right now.">
        Run the Content Studio analysis to generate fresh ideas based on
        current visibility gaps.
      </ReportSectionNote>
    );
  }

  return (
    <ReportSection
      title={TITLE}
      subtitle="Top content ideas from Content Studio, ordered by priority. Generate these to fill the gaps surfaced above."
    >
      <div className="space-y-3">
        {sorted.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
    </ReportSection>
  );
}

function IdeaCard({ idea }: { readonly idea: ContentIdea }) {
  return (
    <div className={REPORT_CARD_CLASS}>
      <div className="flex items-start gap-3">
        <PriorityBadge priority={idea.priority} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {idea.title}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Target: {idea.keyword ?? 'Cross-keyword'}
            {idea.persona_name ? ` · ${idea.persona_name}` : ''}
            {idea.content_angle ? ` · ${formatAngle(idea.content_angle)}` : ''}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
            {idea.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatAngle(angle: string): string {
  return angle.replaceAll('_', ' ');
}
