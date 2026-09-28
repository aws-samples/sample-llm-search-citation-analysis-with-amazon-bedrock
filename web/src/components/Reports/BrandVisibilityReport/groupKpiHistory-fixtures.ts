import type {
  GroupKpiHistoryResponse, GroupRun, GroupRunChange, GroupRunDriver, GroupRunSummary, KeywordRun, KeywordRunHistory
} from '../../../types/domain/groupKpiHistory';

export const RUN_1 = '2026-09-01T06:00:00.000000Z';
export const RUN_2 = '2026-09-08T06:00:00.000000Z';
export const RUN_3 = '2026-09-15T06:00:00.000000Z';

export function buildSummary(overrides: Partial<GroupRunSummary> = {}): GroupRunSummary {
  return {
    coverage_rate: 60,
    first_party_avg_sov: 25,
    rank_1_share: 40,
    top_3_share: 70,
    mean_rank: 1.8,
    mean_first_position: 120,
    first_party_avg_score: 55,
    competitor_avg_score: 45,
    competitor_avg_sov: 50,
    provider_coverage: 50,
    first_party_mean_best_rank: 1.5,
    ...overrides,
  };
}

export function buildDriver(overrides: Partial<GroupRunDriver> = {}): GroupRunDriver {
  return {
    keyword: 'hotel sol spa',
    changes: {
      mention: 'lost',
      first_party_sov: -50,
      rank_1_share: -100,
      top_3_share: -100,
      mean_rank: null,
    },
    impact: {
      coverage_rate: -20,
      first_party_avg_sov: -10,
    },
    ...overrides,
  };
}

export function buildChange(overrides: Partial<GroupRunChange> = {}): GroupRunChange {
  return {
    previous_timestamp: RUN_1,
    deltas: {
      coverage_rate: -20,
      first_party_avg_sov: -10,
      rank_1_share: 5,
      top_3_share: 0,
      mean_rank: 0.5,
    },
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
    summary: buildSummary(),
    models: { openai: ['gpt-5-mini'] },
    change: null,
    ...overrides,
  };
}

export function buildKeywordRun(overrides: Partial<KeywordRun> = {}): KeywordRun {
  return {
    timestamp: RUN_1,
    first_party_mentioned: true,
    first_party_sov: 50,
    rank_1_share: 100,
    top_3_share: 100,
    mean_rank: 1,
    first_party_best_rank: 1,
    answers: 2,
    mentioned_answers: 1,
    first_party_score: 60,
    change: null,
    ...overrides,
  };
}

export function buildKeywordHistory(keyword: string, runs: KeywordRun[]): KeywordRunHistory {
  return {
    keyword,
    runs,
  };
}

/**
 * Two group runs (RUN_1 baseline, RUN_2 after the hotel lost "hotel sol spa")
 * and a partial rerun at RUN_3, with two keywords in the drill-down.
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
    runs: [
      buildRun({
        timestamp: RUN_1,
        summary: buildSummary({ coverage_rate: 80 }),
      }),
      buildRun({
        timestamp: RUN_2,
        summary: buildSummary({ coverage_rate: 60 }),
        models: { openai: ['gpt-5.2'] },
        change: buildChange(),
      }),
      buildRun({
        timestamp: RUN_3,
        keywords_with_data: 1,
        coverage: 20,
        is_group_run: false,
        summary: buildSummary({ coverage_rate: 100 }),
      }),
    ],
    keywords: [
      buildKeywordHistory('hotel sol beach', []),
      buildKeywordHistory('hotel sol spa', [
        buildKeywordRun(),
        buildKeywordRun({
          timestamp: RUN_2,
          first_party_mentioned: false,
          first_party_sov: 0,
          change: {
            previous_timestamp: RUN_1,
            mention: 'lost',
            first_party_sov: -50,
            rank_1_share: -100,
            top_3_share: -100,
            mean_rank: null,
          },
        }),
      ]),
    ],
    ...overrides,
  };
}


/** One group run whose single driver's hotel mention changed as `mention` says. */
export function historyWithDriverMention(mention: GroupRunDriver['changes']['mention']): GroupKpiHistoryResponse {
  const driver = buildDriver();
  return buildHistory({
    runs: [buildRun({
      change: buildChange({
        drivers: [{
          ...driver,
          changes: {
            ...driver.changes,
            mention,
          },
        }],
      }),
    })],
  });
}
