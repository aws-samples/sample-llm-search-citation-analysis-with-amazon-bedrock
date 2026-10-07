import {
  describe, expect, it
} from 'vitest';
import {
  isEnginePlay, isReportInsightsResponse
} from './insightsDecoders';
import { buildNarrative } from './insightsNarrative-fixtures';
import {
  buildEnginePlayRow, buildPortfolioBrand, buildReportInsights, emptyReportInsights, REJECTED_REPORT_INSIGHTS_BODIES
} from './insights-fixtures';
import {
  buildCaveatRow, buildPhase2Insights, buildPromptEngine, buildPromptEngineRow
} from './insightFacts-fixtures';

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
        ...emptyReportInsights().facts,
        portfolio: [buildPortfolioBrand(), unknownBrand],
      },
    }))).toBe(true);
  });

  it('accepts a scope that never ran', () => {
    expect(isReportInsightsResponse(buildReportInsights({
      timestamp: null,
      keywords_with_data: 0,
    }))).toBe(true);
  });

  it('accepts a stored narrative', () => {
    expect(isReportInsightsResponse(buildReportInsights({ narrative: buildNarrative() }))).toBe(true);
  });

  it('rejects a narrative that is not a stored narrative', () => {
    const malformed: unknown = { summary: 'OpenAI rarely ranks you first.' };

    expect(isReportInsightsResponse({
      ...buildReportInsights(),
      narrative: malformed
    })).toBe(false);
  });

  it.each(['get_cited', 'get_ranked_first', 'get_mentioned_and_cited', 'defend'] as const)('accepts the %s play', (play) => {
    expect(isReportInsightsResponse(buildReportInsights({
      facts: {
        ...emptyReportInsights().facts,
        engines: [buildEnginePlayRow('claude', play)],
      },
    }))).toBe(true);
  });

  it('accepts every Phase 2 insight kind, its evidence naming a competitor or an unknown position', () => {
    expect(isReportInsightsResponse(buildReportInsights({ insights: buildPhase2Insights() }))).toBe(true);
  });

  it('accepts a keyword no engine places and a competitor whose caveat share is unknown', () => {
    const unplaced = buildPromptEngineRow({
      visibility_score: null,
      positions: { openai: null },
      lost_engines: ['openai'],
    });

    expect(isReportInsightsResponse(buildReportInsights({
      facts: {
        ...buildReportInsights().facts,
        prompt_engine: buildPromptEngine({ keywords: [unplaced] }),
        competitor_caveats: [buildCaveatRow({ caveat_share: null })],
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
