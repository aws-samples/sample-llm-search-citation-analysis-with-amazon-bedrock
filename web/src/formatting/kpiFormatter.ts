/**
 * How every KPI value and change is written, by the KPI's unit
 * (`docs/kpi-definitions.md`): the same figure reads the same on every page,
 * tooltip and export.
 */
import {
  KPI_DEFINITIONS, type KpiId
} from '../constants/kpiDefinitions';

/** What an unknown value (nothing to divide by) is written as. */
export const EMPTY_KPI = '—';

/** `value` with `digits` decimals and an explicit `+` when it rounds above zero; a value rounding to zero is unsigned. */
function signed(value: number, digits: number): string {
  // Rounding first writes -0.04 as "0.0", not "-0.0" (`(-0).toFixed()` has no sign).
  const rounded = Number(value.toFixed(digits));
  const fixed = rounded.toFixed(digits);
  return rounded > 0 ? `+${fixed}` : fixed;
}

/**
 * A KPI value: `12` answers, `42.5%`, position `2.25`, score `61.3`, net
 * sentiment `+20.0`; an em dash when unknown.
 */
export function formatKpi(id: KpiId, value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_KPI;
  switch (KPI_DEFINITIONS[id].unit) {
    case 'count': return String(value);
    case 'percent': return `${value.toFixed(1)}%`;
    case 'position': return value.toFixed(2);
    case 'score': return value.toFixed(1);
    case 'net': return signed(value, 1);
  }
}

/**
 * A KPI change: `+3` answers, `-2.5 pts` for percentages, scores and net
 * sentiment, `+0.50` positions (worse) for average position; an em dash when
 * unknown.
 */
export function formatKpiDelta(id: KpiId, value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_KPI;
  switch (KPI_DEFINITIONS[id].unit) {
    case 'count': return signed(value, 0);
    case 'position': return signed(value, 2);
    case 'percent':
    case 'score':
    case 'net': return `${signed(value, 1)} pts`;
  }
}
