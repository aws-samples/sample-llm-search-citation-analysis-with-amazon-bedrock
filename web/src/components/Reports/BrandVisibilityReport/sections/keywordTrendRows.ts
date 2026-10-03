import type { ReactElement } from 'react';
import type { KeywordTrend } from '../../../../types';
import {
  gateSection, type TrendSectionProps
} from '../../layout';

interface KeywordTrendRowsOptions extends TrendSectionProps {
  readonly title: string;
  readonly loadingMessage: string;
}

export type KeywordTrendRowsGate =
  | {
    readonly ready: true;
    readonly rows: readonly KeywordTrend[];
  }
  | {
    readonly ready: false;
    readonly placeholder: ReactElement | null;
  };

/**
 * Gates a section on the all-keywords `/trends` payload and lifts out its
 * per-keyword rows (best visibility score first). A payload with no rows
 * hides the section (a `null` placeholder), so callers only ever see a
 * non-empty list.
 */
export function gateKeywordTrendRows({
  trends, ...pending
}: KeywordTrendRowsOptions): KeywordTrendRowsGate {
  const gate = gateSection({
    ...pending,
    value: trends,
  });
  if (!gate.ready) return gate;

  const rows = gate.value.keyword_trends;
  if (rows.length === 0) {
    return {
      ready: false,
      placeholder: null,
    };
  }
  return {
    ready: true,
    rows,
  };
}
