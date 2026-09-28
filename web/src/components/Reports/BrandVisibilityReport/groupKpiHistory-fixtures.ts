import type {
  BrandKpis, GroupKpiHistoryResponse, GroupRun, GroupRunChange, GroupRunDriver, KeywordRun, KeywordRunHistory, KpiDeltas,
  KpiTrend, MentionChange, TrendedKpiId
} from '../../../types/domain/groupKpiHistory';

export const RUN_1 = '2026-09-01T06:00:00.000000Z';
export const RUN_2 = '2026-09-08T06:00:00.000000Z';
export const RUN_3 = '2026-09-15T06:00:00.000000Z';

/**
 * Every KPI of the group at RUN_2 unless overridden. Every value is distinct,
 * so a figure in the wrong column shows up as a wrong value.
 */
export function buildKpis(overrides: Partial<BrandKpis> = {}): BrandKpis {
  return {
    answers: 20,
    mentions: 12,
    mention_rate: 60,
    share_of_voice: 25,
    average_position: 1.8,
    top_1_share: 40,
    top_3_share: 55,
    visibility_score: 52.4,
    citations: 6,
    citation_rate: 30,
    citation_share: 12.5,
    net_sentiment: 15,
    engine_coverage: 75,
    keyword_coverage: 80,
    engines: 4,
    keywords: 5,
    sentiment_split: {
      positive: 5,
      neutral: 4,
      negative: 1,
      mixed: 2,
    },
    ...overrides,
  };
}

/** A change of every KPI, all unknown unless overridden. */
export function buildDeltas(overrides: Partial<KpiDeltas> = {}): KpiDeltas {
  return {
    answers: null,
    mentions: null,
    mention_rate: null,
    share_of_voice: null,
    average_position: null,
    top_1_share: null,
    top_3_share: null,
    visibility_score: null,
    citations: null,
    citation_rate: null,
    citation_share: null,
    net_sentiment: null,
    engine_coverage: null,
    keyword_coverage: null,
    ...overrides,
  };
}

/** Every KPI of `buildKpis()` as unknown: nothing to divide by, no owned domains. */
export function unknownKpis(): BrandKpis {
  return buildKpis(buildDeltas());
}

/** The trend of every trended KPI, all stable unless overridden. */
export function buildTrends(overrides: Partial<Record<TrendedKpiId, KpiTrend>> = {}): Record<TrendedKpiId, KpiTrend> {
  return {
    mention_rate: 'stable',
    share_of_voice: 'stable',
    average_position: 'stable',
    top_1_share: 'stable',
    top_3_share: 'stable',
    visibility_score: 'stable',
    citation_rate: 'stable',
    citation_share: 'stable',
    net_sentiment: 'stable',
    engine_coverage: 'stable',
    keyword_coverage: 'stable',
    ...overrides,
  };
}

/** How the group moved from RUN_1 to RUN_2; every change is distinct. */
export const GROUP_DELTAS: KpiDeltas = buildDeltas({
  answers: 0,
  mentions: -2,
  mention_rate: -10,
  share_of_voice: 5,
  average_position: 0.5,
  top_1_share: 3,
  top_3_share: 1.5,
  visibility_score: -8.2,
  citations: 1,
  citation_rate: 1.2,
  citation_share: -2.5,
  net_sentiment: 10,
  engine_coverage: 0.8,
  keyword_coverage: -20,
});

/** The trends of `GROUP_DELTAS`: improving or declining from 2 points (half a place), else stable. */
export const GROUP_TRENDS = buildTrends({
  mention_rate: 'declining',
  share_of_voice: 'improving',
  average_position: 'declining',
  top_1_share: 'improving',
  visibility_score: 'declining',
  citation_share: 'declining',
  net_sentiment: 'improving',
  keyword_coverage: 'declining',
});

/** "hotel sol spa" no longer names the brand at RUN_2. */
export function buildDriver(overrides: Partial<GroupRunDriver> = {}): GroupRunDriver {
  return {
    keyword: 'hotel sol spa',
    mention: 'lost',
    deltas: buildDeltas({
      answers: 0,
      mentions: -2,
      mention_rate: -50,
      share_of_voice: -25,
      top_1_share: -50,
      top_3_share: -50,
      visibility_score: -45,
    }),
    impact: {
      mention_rate: -10,
      visibility_score: -9,
    },
    ...overrides,
  };
}

export function buildChange(overrides: Partial<GroupRunChange> = {}): GroupRunChange {
  return {
    previous_timestamp: RUN_1,
    deltas: GROUP_DELTAS,
    trends: GROUP_TRENDS,
    drivers: [buildDriver()],
    keywords_entered: [],
    keywords_left: [],
    ...overrides,
  };
}

export function buildRun(overrides: Partial<GroupRun> = {}): GroupRun {
  return {
    timestamp: RUN_2,
    keywords_with_data: 5,
    keywords_total: 5,
    coverage: 100,
    is_group_run: true,
    kpis: buildKpis(),
    models: { openai: ['gpt-5-mini'] },
    change: null,
    ...overrides,
  };
}

/** The KPIs of "hotel sol spa" at RUN_1, when two of its four answers named the brand. */
export const KEYWORD_KPIS: BrandKpis = buildKpis({
  answers: 4,
  mentions: 2,
  mention_rate: 50,
  share_of_voice: 25,
  average_position: 1.5,
  top_1_share: 25,
  top_3_share: 50,
  visibility_score: 47.5,
  citations: 1,
  citation_rate: 25,
  net_sentiment: 50,
});

export function buildKeywordRun(overrides: Partial<KeywordRun> = {}): KeywordRun {
  return {
    timestamp: RUN_1,
    kpis: KEYWORD_KPIS,
    change: null,
    ...overrides,
  };
}

/** A keyword run's change since RUN_1: its mention as `mention` says, and `deltas` over unknown changes. */
export function buildKeywordChange(mention: MentionChange, deltas: Partial<KpiDeltas> = {}): KeywordRun['change'] {
  return {
    previous_timestamp: RUN_1,
    mention,
    deltas: buildDeltas(deltas),
  };
}

/** "hotel sol spa" at RUN_2: no answer names the brand any more. */
export const LOST_KEYWORD_RUN: KeywordRun = buildKeywordRun({
  timestamp: RUN_2,
  kpis: {
    ...KEYWORD_KPIS,
    mentions: 0,
    mention_rate: 0,
    share_of_voice: 0,
    average_position: null,
    top_1_share: 0,
    top_3_share: 0,
    visibility_score: 0,
    net_sentiment: null,
  },
  change: buildKeywordChange('lost', {
    answers: 0,
    mentions: -2,
    mention_rate: -50,
    share_of_voice: -25,
    top_1_share: -25,
    top_3_share: -50,
    visibility_score: -47.5,
    citations: 0,
    citation_rate: 0,
  }),
});

export function buildKeywordHistory(keyword: string, runs: KeywordRun[]): KeywordRunHistory {
  return {
    keyword,
    runs,
  };
}

/**
 * Two group runs (RUN_1 baseline, RUN_2 after the brand lost "hotel sol spa")
 * and a partial rerun at RUN_3, with two keywords in the drill-down: "hotel
 * sol beach" without runs and "hotel sol spa" with two.
 */
export function buildHistory(overrides: Partial<GroupKpiHistoryResponse> = {}): GroupKpiHistoryResponse {
  return {
    scope: {
      kind: 'group',
      label: 'Hotel Sol',
      keyword_count: 2,
    },
    days: 90,
    group_run_min_coverage: 50,
    keywords_truncated: false,
    citations_configured: true,
    runs: [
      buildRun({
        timestamp: RUN_1,
        kpis: buildKpis({
          mention_rate: 70,
          share_of_voice: 20,
        }),
      }),
      buildRun({
        timestamp: RUN_2,
        models: { openai: ['gpt-5.2'] },
        change: buildChange(),
      }),
      buildRun({
        timestamp: RUN_3,
        keywords_with_data: 1,
        coverage: 20,
        is_group_run: false,
        kpis: buildKpis({
          answers: 4,
          mention_rate: 100,
        }),
      }),
    ],
    keywords: [
      buildKeywordHistory('hotel sol beach', []),
      buildKeywordHistory('hotel sol spa', [buildKeywordRun(), LOST_KEYWORD_RUN]),
    ],
    ...overrides,
  };
}

/** `buildHistory()` before owned domains are set: the citation KPIs of every run are unknown. */
export function historyWithoutOwnedDomains(): GroupKpiHistoryResponse {
  const history = buildHistory();
  return {
    ...history,
    citations_configured: false,
    runs: history.runs.map((run) => ({
      ...run,
      kpis: {
        ...run.kpis,
        citations: null,
        citation_rate: null,
        citation_share: null,
      },
    })),
  };
}

/** One group run whose single driver's brand mention changed as `mention` says. */
export function historyWithDriverMention(mention: MentionChange): GroupKpiHistoryResponse {
  return buildHistory({runs: [buildRun({change: buildChange({drivers: [buildDriver({ mention })]})})]});
}

/** A group whose only keyword, "k", has the single run `run`. */
export function historyWithKeywordRun(run: KeywordRun): GroupKpiHistoryResponse {
  return buildHistory({ keywords: [buildKeywordHistory('k', [run])] });
}
