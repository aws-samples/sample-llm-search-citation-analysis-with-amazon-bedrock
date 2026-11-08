import type {
  CompetitorReportResponse, CompetitorRollup
} from '../../../../api/reports';
import type { ListRequest } from '../../../../api/scopedListPages';
import {
  gateSection, type SectionFetchState, type SectionGate
} from '../../layout/sectionGate';

/** The props of the sections listing part of one competitor's rollup. */
export interface RollupSectionProps extends SectionFetchState {
  readonly rollup: CompetitorRollup | null;
  /** The whole answer (2.45.0): its coverage, and the cursor of the outranked keywords. */
  readonly response?: CompetitorReportResponse | null;
  /** The request the answer came from: the outranked keywords load their next pages with it. */
  readonly request?: ListRequest | null;
}

/** The rollup part of the Competitor Gap data, as every rollup section reads it. */
export function rollupSlice({
  rollup, loading, error, computing = null, response = null, request = null
}: RollupSectionProps): RollupSectionProps {
  return {
    rollup,
    loading,
    error,
    // The 2.45.0 fields only when set, so an older slice keeps its three fields.
    ...(computing === null ? {} : { computing }),
    ...(response === null ? {} : { response }),
    ...(request === null ? {} : { request }),
  };
}

/** A rollup list section's loading and error states; nothing until the rollup arrives. */
export function gateRollup(title: string, {
  rollup, loading, error, computing
}: RollupSectionProps): SectionGate<CompetitorRollup> {
  return gateSection({
    title,
    loading,
    computing,
    loadingMessage: 'Loading…',
    error,
    value: rollup,
  });
}
