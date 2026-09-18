import type { ReactElement } from 'react';
import { ReportSectionPlaceholder } from './ReportSectionPlaceholder';

interface PendingSectionOptions {
  /** Section heading, kept visible in every placeholder state. */
  readonly title: string;
  readonly loading: boolean;
  readonly loadingMessage: string;
  /** Subtitle shown under the heading while loading, for sections that want one. */
  readonly loadingSubtitle?: string;
  readonly error: string | null;
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
  loadingSubtitle,
  error,
}: PendingSectionOptions): ReactElement | null {
  if (loading) {
    return (
      <ReportSectionPlaceholder
        title={title}
        subtitle={loadingSubtitle}
        variant="loading"
        message={loadingMessage}
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
