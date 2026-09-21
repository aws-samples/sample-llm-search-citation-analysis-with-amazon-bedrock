import type { ContentStudioHistory } from '../../../../types';
import {
  formatContentWarning, getContentTitle
} from '../../../ContentStudio/contentPresentation';
import {
  ReportSection, SectionPlaceholder
} from '../../layout';

interface Props {
  readonly history: ReadonlyArray<ContentStudioHistory>;
  readonly loading: boolean;
  readonly error: string | null;
}

const MAX_BRIEFS = 8;

/**
 * What's already been generated and is sitting in Content Studio waiting to
 * be used. Shows the title, target keyword, key talking points, and a
 * truncated meta description so a strategist can decide on the spot whether
 * the brief is ready to publish or needs revision.
 *
 * Pending and failed items are excluded — this is the "ready to ship" list,
 * not the operational queue.
 */
export function BriefsReadySection({
  history, loading, error
}: Props) {
  if (loading) {
    return (
      <ReportSection title="Briefs ready to use">
        <SectionPlaceholder variant="loading" message="Loading content history…" />
      </ReportSection>
    );
  }

  if (error) {
    return (
      <ReportSection title="Briefs ready to use">
        <SectionPlaceholder variant="error" message={error} />
      </ReportSection>
    );
  }

  const ready = history
    .filter((item) => item.status === 'generated')
    .slice(0, MAX_BRIEFS);

  if (ready.length === 0) {
    return (
      <ReportSection
        title="Briefs ready to use"
        subtitle="No generated briefs are waiting to be published."
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Generate content from the Content Studio to populate this section.
        </p>
      </ReportSection>
    );
  }

  return (
    <ReportSection
      title="Briefs ready to use"
      subtitle="Generated content awaiting review or publish. Pair each brief with the corresponding citation target to close a gap."
      startNewPage
    >
      <div className="space-y-3">
        {ready.map((item) => (
          <BriefCard key={item.id} item={item} />
        ))}
      </div>
    </ReportSection>
  );
}

function BriefCard({ item }: { readonly item: ContentStudioHistory }) {
  const generated = item.generated_content;
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 avoid-break-inside">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {getContentTitle(item)}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Target keyword: {item.keyword}
          </p>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>
      {item.content_warning && (
        <output className="block rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">Needs review: </span>
          {formatContentWarning(item.content_warning)}
        </output>
      )}
      {generated?.meta_description && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
          {generated.meta_description}
        </p>
      )}
      {generated?.key_points && generated.key_points.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
            Key points
          </p>
          <ul className="text-sm text-gray-700 dark:text-gray-300 list-disc ml-4 space-y-0.5">
            {generated.key_points.slice(0, 4).map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
