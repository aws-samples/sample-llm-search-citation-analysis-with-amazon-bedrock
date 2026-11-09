/**
 * The citation rules a KPI object's answers were stored under (2.52.0; `lambda/shared/kpi_engine.py`
 * `citation_versions`). `2`: only the sources the answer cites count. `unversioned (pre-2.43.0)`: rows from before
 * 2.43.0, which counted every source the engine returned.
 */

/** Answers stored under one citation rule. */
export interface CitationVersionCount {
  readonly version: string;
  readonly answers: number;
}

/** The citation-rule fields of a KPI object (absent from API builds before 2.52.0). */
export interface CitationVersionFields {
  readonly citation_versions?: readonly CitationVersionCount[];
  /** The answers come from more than one rule, so a citation KPI over them adds up two definitions. */
  readonly citation_versions_mixed?: boolean;
}
