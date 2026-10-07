import {
  describe, expect, it
} from 'vitest';
import {
  isEnginePlay, isReportInsightsResponse
} from './insightsDecoders';
import {
  buildEnginePlayRow, buildPortfolioBrand, buildReportInsights, emptyReportInsights, REJECTED_REPORT_INSIGHTS_BODIES
} from './insights-fixtures';

describe('isReportInsightsResponse', () => {
  it('accepts the insights the API answers', () => {
    expect(isReportInsightsResponse(buildReportInsights())).toBe(true);
  });

  it('accepts a scope with no fact and no insight', () => {
    expect(isReportInsightsResponse(emptyReportInsights())).toBe(true);
  });

  it('accepts a brand whose position, sentiment and gaps are unknown', () => {
    const unknownBrand = buildPortfolioBrand({
      average_position: null,
      net_sentiment: null,
      position_gap: null,
      sentiment_gap: null,
      weak: false,
    });

    expect(isReportInsightsResponse(buildReportInsights({
      facts: {
        engines: [],
        portfolio: [buildPortfolioBrand(), unknownBrand],
        stability: [],
      },
    }))).toBe(true);
  });

  it('accepts a scope that never ran', () => {
    expect(isReportInsightsResponse(buildReportInsights({
      timestamp: null,
      keywords_with_data: 0,
    }))).toBe(true);
  });

  it('accepts a narrative once it is an object', () => {
    expect(isReportInsightsResponse(buildReportInsights({ narrative: { summary: 'OpenAI rarely ranks you first.' } }))).toBe(true);
  });

  it.each(['get_cited', 'get_ranked_first', 'get_mentioned_and_cited', 'defend'] as const)('accepts the %s play', (play) => {
    expect(isReportInsightsResponse(buildReportInsights({
      facts: {
        engines: [buildEnginePlayRow('claude', play)],
        portfolio: [],
        stability: [],
      },
    }))).toBe(true);
  });

  it.each(REJECTED_REPORT_INSIGHTS_BODIES)('rejects %s', (_description, body) => {
    expect(isReportInsightsResponse(body)).toBe(false);
  });
});

describe('isEnginePlay', () => {
  it('knows the four plays', () => {
    expect(['get_cited', 'get_ranked_first', 'get_mentioned_and_cited', 'defend'].every(isEnginePlay)).toBe(true);
  });

  it('rejects a play the dashboard cannot label', () => {
    expect(isEnginePlay('attack')).toBe(false);
  });
});
