/**
 * The visibility KPIs, in the words shown to customers: tooltips, the
 * definitions block of every report, the About › Metrics page and the
 * exports.
 *
 * `docs/kpi-definitions.md` is the specification and
 * `lambda/shared/kpi_engine.py` the calculation. The three list the same
 * KPIs, in the same order (`lambda/shared/test_kpi_contract.py`); change
 * them together.
 */

/** Every KPI id, in the order reports list them (`KPI_IDS` in the engine). */
export const KPI_IDS = [
  'answers',
  'mentions',
  'mention_rate',
  'share_of_voice',
  'average_position',
  'top_1_share',
  'top_3_share',
  'visibility_score',
  'citations',
  'citation_rate',
  'citation_share',
  'net_sentiment',
  'engine_coverage',
  'keyword_coverage',
] as const;

export type KpiId = (typeof KPI_IDS)[number];

/**
 * How a KPI's value reads: a count, a percentage (changes in points), a
 * position (lower is better), a 0–100 score, or a −100…+100 net value.
 */
export type KpiUnit = 'count' | 'percent' | 'position' | 'score' | 'net';

export interface KpiDefinition {
  readonly label: string;
  readonly definition: string;
}

export interface KpiSpec extends KpiDefinition {
  readonly id: KpiId;
  readonly unit: KpiUnit;
}

const ANSWER_NOTE = 'An answer is one successful response of one AI engine to one query in one run.';

export const KPI_DEFINITIONS: Readonly<Record<KpiId, KpiSpec>> = {
  answers: {
    id: 'answers',
    unit: 'count',
    label: 'Answers',
    definition: `The AI answers these figures are computed from. ${ANSWER_NOTE} `
      + 'Web-search providers and failed calls are not answers. Small samples are noisy: with 20 answers, one mention moves a rate by 5 points.',
  },
  mentions: {
    id: 'mentions',
    unit: 'count',
    label: 'Mentions',
    definition: 'Answers that name your brand at least once. An answer counts once, however often it repeats the name.',
  },
  mention_rate: {
    id: 'mention_rate',
    unit: 'percent',
    label: 'Mention rate',
    definition: 'Share of AI answers that name your brand: mentions ÷ answers. '
      + 'It reads the answer text only; whether your website is cited as a source is the citation rate.',
  },
  share_of_voice: {
    id: 'share_of_voice',
    unit: 'percent',
    label: 'Share of voice',
    definition: 'Your brand\'s share of all brand mentions in the answers (yours, competitors\' and others\'). '
      + 'Each brand counts once per answer.',
  },
  average_position: {
    id: 'average_position',
    unit: 'position',
    label: 'Average position',
    definition: 'Your brand\'s average place among the brands an answer names (1 = named first), '
      + 'over the answers that name and place it. Lower is better; read it with the mention rate.',
  },
  top_1_share: {
    id: 'top_1_share',
    unit: 'percent',
    label: 'Top-1 share',
    definition: 'Share of all answers that name your brand first, including answers that do not mention it.',
  },
  top_3_share: {
    id: 'top_3_share',
    unit: 'percent',
    label: 'Top-3 share',
    definition: 'Share of all answers that name your brand among the first three brands, including answers that do not mention it.',
  },
  visibility_score: {
    id: 'visibility_score',
    unit: 'score',
    label: 'Visibility score',
    definition: 'How often and how early answers name your brand, from 0 to 100. Each answer scores 100 when it names you first, '
      + '90 second, 81 third (10 % less per place, down to the 10th), and 0 when it does not name you. Sentiment is not included.',
  },
  citations: {
    id: 'citations',
    unit: 'count',
    label: 'Citations',
    definition: 'Answers that cite at least one of your owned domains as a source. Set owned domains in Settings › Brand Tracking.',
  },
  citation_rate: {
    id: 'citation_rate',
    unit: 'percent',
    label: 'Citation rate',
    definition: 'Share of AI answers that cite your website (an owned domain or its subdomains) as a source, '
      + 'whether or not the text names your brand. Empty until owned domains are set.',
  },
  citation_share: {
    id: 'citation_share',
    unit: 'percent',
    label: 'Citation share',
    definition: 'Your owned domains\' share of all the sources the answers cite. Each domain counts once per answer. '
      + 'Empty until owned domains are set.',
  },
  net_sentiment: {
    id: 'net_sentiment',
    unit: 'net',
    label: 'Net sentiment',
    definition: 'Positive minus negative mentions of your brand, as a share of the mentions with a sentiment, '
      + 'from −100 (all negative) to +100 (all positive). Neutral and mixed mentions pull it towards 0.',
  },
  engine_coverage: {
    id: 'engine_coverage',
    unit: 'percent',
    label: 'Engine coverage',
    definition: 'Share of the AI engines that answered whose answers name your brand at least once.',
  },
  keyword_coverage: {
    id: 'keyword_coverage',
    unit: 'percent',
    label: 'Keyword coverage',
    definition: 'Share of the answered keywords where at least one AI answer names your brand, '
      + 'however many engines do.',
  },
};

/** Every KPI, in report order. */
export const KPI_SPECS: readonly KpiSpec[] = KPI_IDS.map((id) => KPI_DEFINITIONS[id]);

/** What makes a run comparable; listed with the KPI definitions of the per-group report. */
export const GROUP_RUN_DEFINITION: KpiDefinition = {
  label: 'Group run',
  definition:
    'An analysis run that answered at least half of the group\'s keywords. Only group runs are compared with each other; '
    + 'a run of a single keyword stays in the keyword detail but is not treated as the group\'s visibility.',
};

/** How a change is judged; listed with the KPI definitions of every report with changes. */
export const TREND_DEFINITION: KpiDefinition = {
  label: 'Change and trend',
  definition:
    'A change compares a KPI with the previous comparable run or period, in points for percentages and scores and in places for '
    + 'the average position. It counts as improving or declining from 2 points (half a place for the average position); '
    + 'anything smaller is stable, within the normal run-to-run variation of AI answers.',
};


/** Everything the per-group report measures, in the order its definitions block lists them. */
export const GROUP_REPORT_DEFINITIONS: readonly KpiDefinition[] = [...KPI_SPECS, GROUP_RUN_DEFINITION, TREND_DEFINITION];
