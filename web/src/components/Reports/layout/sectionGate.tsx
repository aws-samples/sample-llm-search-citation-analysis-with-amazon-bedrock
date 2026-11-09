import type { ReactElement } from 'react';
import { ReportSectionPlaceholder } from './ReportSectionPlaceholder';
import type { ComputingResponse } from '../../../types/domain/scopeCoverage';
import type { SectionShape } from './SectionSkeleton';

/** Whether the fetch a report section renders from is still in flight, or failed. */
export interface SectionFetchState {
  readonly loading: boolean;
  readonly error: string | null;
  /** The fetch waits for a `202` view job (2.45.0): the loading placeholder says the complete figures are being computed. */
  readonly computing?: ComputingResponse | null;
}

/** The loading text of a section whose figures a view job is computing. */
export const COMPUTING_SECTION_MESSAGE = 'Computing the complete figures for every keyword of this scope… This can take a few minutes; the report updates by itself.';

/** A report section's payload (`null` until it is loaded) and the state of its fetch. */
export interface ReportSlice<T> extends SectionFetchState {readonly data: T | null;}

interface PendingSectionOptions extends SectionFetchState {
  /** Section heading, kept visible in every placeholder state. */
  readonly title: string;
  readonly loadingMessage: string;
  /** What the section will show (tiles, a chart, a table), so its loading skeleton takes that shape. */
  readonly loadingShape?: SectionShape;
  /** Subtitle shown under the heading while loading, for sections that want one. */
  readonly loadingSubtitle?: string;
}

/**
 * Loading / error placeholders for a section whose fetch has not settled.
 *
 * Every report section follows the same opening moves: show a loading
 * placeholder, then an error placeholder, and only then render content.
 * Returns `null` once the section is free to render.
 */
export function pendingSectionPlaceholder({
  title,
  loading,
  loadingMessage,
  loadingShape,
  loadingSubtitle,
  error,
  computing = null,
}: PendingSectionOptions): ReactElement | null {
  if (loading) {
    return (
      <ReportSectionPlaceholder
        title={title}
        subtitle={loadingSubtitle}
        variant="loading"
        message={computing === null ? loadingMessage : COMPUTING_SECTION_MESSAGE}
        shape={loadingShape}
      />
    );
  }
  if (error) {
    return <ReportSectionPlaceholder title={title} variant="error" message={error} />;
  }
  return null;
}

interface SectionGateOptions<T> extends PendingSectionOptions {
  /** The payload the section renders from; null / undefined means "nothing yet". */
  readonly value: T | null | undefined;
  /**
   * Copy for the empty state when `value` is missing. Sections that should
   * simply disappear from the report in that case leave it undefined.
   */
  readonly emptyMessage?: string;
}

export type SectionGate<T> =
  | {
    readonly ready: true;
    readonly value: T;
  }
  | {
    readonly ready: false;
    readonly placeholder: ReactElement | null;
  };

/**
 * Resolves the loading → error → empty → ready progression of a section in
 * one call, narrowing `value` to non-null on the ready branch:
 *
 *   const gate = gateSection({ title, loading, loadingMessage, error, value });
 *   if (!gate.ready) return gate.placeholder;
 *   // gate.value is now the non-null payload
 */
export function gateSection<T>({
  value,
  emptyMessage,
  ...pending
}: SectionGateOptions<T>): SectionGate<T> {
  const placeholder = pendingSectionPlaceholder(pending);
  if (placeholder) {
    return {
      ready: false,
      placeholder,
    };
  }
  if (value === null || value === undefined) {
    return {
      ready: false,
      placeholder: emptyMessage === undefined
        ? null
        : <ReportSectionPlaceholder title={pending.title} variant="empty" message={emptyMessage} />,
    };
  }
  return {
    ready: true,
    value,
  };
}
