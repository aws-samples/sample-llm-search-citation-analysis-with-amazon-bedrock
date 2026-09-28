/**
 * How the report's visibility KPIs are measured, in the words shown to
 * customers (tooltips, the definitions block of the report, the export).
 *
 * These describe the formulas in `lambda/shared/visibility_score.py` and
 * `lambda/shared/group_kpi_history.py`; change them together.
 */

export interface KpiDefinition {
  readonly label: string;
  readonly definition: string;
}

export const CITATION_RATE_DEFINITION: KpiDefinition = {
  label: 'Citation rate',
  definition:
    'Share of this group\'s keywords where at least one AI answer mentions the hotel (any first-party brand), '
    + 'counting only keywords with results in the run. A keyword counts once however many AI providers mention the hotel. '
    + 'It measures mentions in the answer text; it does not check whether the hotel\'s website is cited as a source.',
};

export const SHARE_OF_VOICE_DEFINITION: KpiDefinition = {
  label: 'Share of voice',
  definition:
    'For each keyword, the hotel\'s brand mentions divided by all brand mentions (hotel, competitors and others) '
    + 'across the run\'s AI answers. The group value is the average over keywords with results, each keyword weighing the same.',
};

export const PROMINENCE_DEFINITION: KpiDefinition = {
  label: 'Prominence',
  definition:
    'Where the hotel is placed inside each AI answer. Rank #1 share and top-3 share divide by every answer, '
    + 'including answers that do not mention the hotel. Mean rank averages the hotel\'s best position in the answers '
    + 'that rank it (lower is better). Group values average the keywords.',
};

export const GROUP_RUN_DEFINITION: KpiDefinition = {
  label: 'Group run',
  definition:
    'An analysis run that covered at least half of the group\'s keywords. Only group runs are compared with each other; '
    + 'a run of a single keyword stays in the keyword detail but is not treated as the hotel\'s visibility.',
};

/** Every definition, in the order the report lists them. */
export const VISIBILITY_KPI_DEFINITIONS: readonly KpiDefinition[] = [
  CITATION_RATE_DEFINITION,
  SHARE_OF_VOICE_DEFINITION,
  PROMINENCE_DEFINITION,
  GROUP_RUN_DEFINITION,
];
