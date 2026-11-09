import type { ScopedResponseFields } from '../../types/domain/scopeCoverage';
import { formatDate } from '../../formatting/dateFormatter';
import {
  CitationVersionsNote, citationVersionsOf 
} from './CitationVersionsNote';

/*
 * How complete and how current a scoped view's figures are (2.45.0 `coverage` and source
 * envelope, `types/domain/scopeCoverage.ts`). Every scoped view shows it above its figures.
 *
 * - All keywords included: a grey line, "Covers all 928 keywords", plus the build time of
 *   snapshot figures.
 * - Fewer: a yellow note. Since 2.45.0 there is no keyword cap, so the only cause is a live
 *   read the request's time budget cut short, and the note says exactly that.
 * - A snapshot older than the scope (`stale`): a blue "Updating…" note; the data hook refetches
 *   until the answer is current (`hooks/useStaleRefetch.ts`).
 * - A body from an API build before 2.45.0 carries none of the fields: nothing is shown.
 */

const COUNT = new Intl.NumberFormat('en');

function keywordsLabel(count: number): string {
  return `${COUNT.format(count)} keyword${count === 1 ? '' : 's'}`;
}

/** The sentence a coverage reads as, e.g. "Covers 100 of 928 keywords". */
export function coverageSentence(analyzed: number, total: number): string {
  return analyzed >= total
    ? `Covers all ${keywordsLabel(total)}`
    : `Covers ${COUNT.format(analyzed)} of ${keywordsLabel(total)}`;
}

interface ScopeCoverageNoteProps {
  /** The scoped response (or `null` before it loads). */
  readonly response: ScopedResponseFields | null | undefined;
  /** Layout classes for the wrapper, e.g. `mb-4`. */
  readonly className?: string;
}

function CompleteLine({ response }: { readonly response: ScopedResponseFields & { coverage: { keywords_total: number } } }) {
  const asOf = response.source === 'snapshot' && typeof response.as_of === 'string'
    ? ` · figures as of ${formatDate(response.as_of)}`
    : '';
  return (
    <p className="text-xs text-gray-500">
      {coverageSentence(response.coverage.keywords_total, response.coverage.keywords_total)}{asOf}
    </p>
  );
}

function StaleNote({ refreshing }: { readonly refreshing: boolean }) {
  return (
    <output className="block text-xs px-3 py-2 rounded-lg border bg-blue-50 text-blue-700 border-blue-200">
      {refreshing
        ? 'Updating to the latest keyword changes… These figures are from the previous build and refresh by themselves.'
        : 'These figures are from before the latest keyword changes; they update after the next rebuild.'}
    </output>
  );
}

/** The coverage and freshness of a scoped view; nothing for an older API body. */
export function ScopeCoverageNote({
  response, className = ''
}: ScopeCoverageNoteProps) {
  const coverage = response?.coverage;
  const stale = response?.stale === true;
  const mixed = citationVersionsOf(response).length > 1;
  if (coverage === undefined && !stale && !mixed) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {coverage !== undefined && (coverage.complete
        ? <CompleteLine response={{
          ...response,
          coverage 
        }} />
        : (
          <p role="note" className="text-sm px-3 py-2 rounded-lg border bg-yellow-50 text-yellow-800 border-yellow-200">
            {`${coverageSentence(coverage.keywords_analyzed, coverage.keywords_total)}. `}
            The request ran out of time before it read the rest, so their figures are left out. Reload to try again.
          </p>
        ))}
      {stale && <StaleNote refreshing={response?.refreshing === true} />}
      {mixed && <CitationVersionsNote response={response} />}
    </div>
  );
}
