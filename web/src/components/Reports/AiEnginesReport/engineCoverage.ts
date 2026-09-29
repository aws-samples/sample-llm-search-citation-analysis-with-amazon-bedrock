import type { EngineKpis } from '../../../types';

/** How far your brand reaches across the AI engines that answered. */
export interface EngineCoverage {
  readonly answering: number;
  /** Engines with at least one answer naming your brand. */
  readonly naming: number;
  /** The engine with the highest visibility score (the first in name order on a tie); `null` without an engine. */
  readonly strongest: EngineKpis | null;
}

function higherScore(strongest: EngineKpis | null, engine: EngineKpis): EngineKpis | null {
  const best = strongest?.kpis.visibility_score ?? null;
  const score = engine.kpis.visibility_score;
  if (score === null) return strongest;
  return best === null || score > best ? engine : strongest;
}

/** The engines answering, those naming your brand, and your strongest engine. */
export function engineCoverage(engines: readonly EngineKpis[]): EngineCoverage {
  return {
    answering: engines.length,
    naming: engines.filter((engine) => (engine.kpis.mentions ?? 0) > 0).length,
    strongest: engines.reduce<EngineKpis | null>(higherScore, null),
  };
}
