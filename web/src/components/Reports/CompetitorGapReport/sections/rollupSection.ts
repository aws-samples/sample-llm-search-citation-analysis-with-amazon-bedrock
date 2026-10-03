import type { CompetitorRollup } from '../../../../api/reports';
import {
  gateSection, type SectionFetchState, type SectionGate
} from '../../layout/sectionGate';

/** The props of the sections listing part of one competitor's rollup. */
export interface RollupSectionProps extends SectionFetchState {readonly rollup: CompetitorRollup | null;}

/** The rollup part of the Competitor Gap data, as every rollup section reads it. */
export function rollupSlice({
  rollup, loading, error
}: RollupSectionProps): RollupSectionProps {
  return {
    rollup,
    loading,
    error,
  };
}

/** A rollup list section's loading and error states; nothing until the rollup arrives. */
export function gateRollup(title: string, {
  rollup, loading, error
}: RollupSectionProps): SectionGate<CompetitorRollup> {
  return gateSection({
    title,
    loading,
    loadingMessage: 'Loading…',
    error,
    value: rollup,
  });
}
