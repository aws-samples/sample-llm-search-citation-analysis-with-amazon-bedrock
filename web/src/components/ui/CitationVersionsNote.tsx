/*
 * Whether a view's citation figures add up answers stored under different citation rules (2.48.0, tenet 2).
 *
 * Since 2.43.0 an answer row records `citations_version`: 2 counts only the sources the answer cites. Rows from
 * before carry none ("unversioned (pre-2.43.0)") and counted every source the engine returned. Every KPI object
 * the API answers says which rules its answers were stored under (`citation_versions`) and whether it mixes them
 * (`citation_versions_mixed`); a view over a period that spans the upgrade shows this note above its figures.
 */

import type {
  CitationVersionCount, CitationVersionFields 
} from '../../types/domain/citationVersions';

const COUNT = new Intl.NumberFormat('en');

function versionsOfKpis(value: unknown): readonly CitationVersionCount[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as CitationVersionFields).citation_versions;
}

/**
 * The answers per citation rule behind `response`'s figures: its own `kpis` when it has them (the whole scope),
 * else the sum of its trend periods (`trend_data`, disjoint windows).
 */
export function citationVersionsOf(response: unknown): CitationVersionCount[] {
  if (typeof response !== 'object' || response === null) return [];
  const {
    kpis, trend_data: trendData 
  } = response as {
    kpis?: unknown;
    trend_data?: unknown 
  };
  const own = versionsOfKpis(kpis);
  const periods = Array.isArray(trendData) ? trendData.map((period: unknown) => versionsOfKpis((period as { kpis?: unknown } | null)?.kpis)) : [];
  const totals = new Map<string, number>();
  for (const versions of own === undefined ? periods : [own]) {
    for (const {
      version, answers 
    } of versions ?? []) totals.set(version, (totals.get(version) ?? 0) + answers);
  }
  return [...totals].map(([version, answers]) => ({
    version,
    answers,
  }));
}

/** "under citation rule 2" for a numbered rule; an unversioned rule names itself. */
function ruleLabel(version: string): string {
  return /^\d+$/.test(version) ? 'under citation rule ' + version : version;
}

/** A note when the figures mix citation rules; nothing otherwise (or for an older API body). */
export function CitationVersionsNote({ response }: { readonly response: unknown }) {
  const versions = citationVersionsOf(response);
  if (versions.length < 2) return null;
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
