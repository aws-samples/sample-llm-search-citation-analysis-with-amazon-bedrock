/*
 * Whether a view's citation figures add up answers stored under different citation rules (2.52.0, tenet 2).
 *
 * Since 2.43.0 an answer row records `citations_version`: 2 counts only the sources the answer cites. Rows from
 * before carry none ("unversioned (pre-2.43.0)") and counted every source the engine returned. Every KPI object
 * the API answers says which rules its answers were stored under (`citation_versions`) and whether it mixes them
 * (`citation_versions_mixed`), and a trend says it for its whole window. The server decides the mix; a view whose
 * figures mix rules shows this note above them.
 */

import type { CitationVersionFields } from '../../types/domain/citationVersions';

const COUNT = new Intl.NumberFormat('en');

function isVersionFields(value: unknown): value is CitationVersionFields {
  return typeof value === 'object' && value !== null && 'citation_versions_mixed' in value;
}

/**
 * The citation-rule fields the server gave `response`'s figures: a trend's own (its whole window, every period
 * together), else its `kpis` (the scope's); `undefined` for an API body from before 2.52.0.
 */
export function citationVersionFieldsOf(response: unknown): CitationVersionFields | undefined {
  if (isVersionFields(response)) return response;
  const kpis = typeof response === 'object' && response !== null ? (response as { kpis?: unknown }).kpis : undefined;
  return isVersionFields(kpis) ? kpis : undefined;
}

/** "under citation rule 2" for a numbered rule; an unversioned rule names itself. */
function ruleLabel(version: string): string {
  return /^\d+$/.test(version) ? 'under citation rule ' + version : version;
}

/** A note when the figures mix citation rules; nothing otherwise (or for an older API body). */
export function CitationVersionsNote({ response }: { readonly response: unknown }) {
  const fields = citationVersionFieldsOf(response);
  if (fields?.citation_versions_mixed !== true) return null;
  const versions = fields.citation_versions ?? [];
  const parts = versions.map(({
    version, answers 
  }) => `${COUNT.format(answers)} answers ${ruleLabel(version)}`);
  return (
    <p role="note" className="text-sm px-3 py-2 rounded-lg border bg-yellow-50 text-yellow-800 border-yellow-200">
      {`The citation figures here mix two definitions: ${parts.join(' and ')}. `}
      Answers stored before 2.43.0 counted every source an engine returned; later ones count only the sources the
      answer cites. Compare citation figures within one rule.
    </p>
  );
}
