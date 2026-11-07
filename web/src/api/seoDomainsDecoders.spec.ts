import {
  describe, expect, it
} from 'vitest';
import {
  isDomainKeywordsResponse,
  isDomainOverviewResponse,
  isDomainPagesResponse,
  isDomainSnapshotsResponse,
  isRankedKeywordRow,
  isSeoInsightsResponse,
  isSeoRecommendation,
  isSerpCompetitorsResponse,
  isTakeSnapshotResponse,
} from './seoDomainsDecoders';
import {
  buildDomainKeywords,
  buildDomainOverview,
  buildDomainPages,
  buildDomainSnapshots,
  buildRankedKeyword,
  buildSeoInsights,
  buildSeoRecommendation,
  buildSerpCompetitors,
  LABS_EXPORT,
  SNAPSHOT_STARTED,
} from './seoDomains-fixtures';
import { withoutField } from './seo-fixtures';

describe('domain answers', () => {
  it.each([
    ['overview', isDomainOverviewResponse, buildDomainOverview()],
    ['keywords page', isDomainKeywordsResponse, buildDomainKeywords()],
    ['pages page', isDomainPagesResponse, buildDomainPages()],
    ['competitors', isSerpCompetitorsResponse, buildSerpCompetitors()],
    ['snapshots', isDomainSnapshotsResponse, buildDomainSnapshots()],
    ['insights', isSeoInsightsResponse, buildSeoInsights()],
  ])('accepts a well-formed %s answer', (_name, guard, payload) => {
    expect(guard(payload)).toBe(true);
  });

  it('refuses an overview with an unknown scope', () => {
    expect(isDomainOverviewResponse(buildDomainOverview({ scope: 'everything' as never }))).toBe(false);
  });

  it('refuses an overview without its cache flag', () => {
    expect(isDomainOverviewResponse(withoutField(buildDomainOverview(), 'cached'))).toBe(false);
  });

  it('refuses a keywords page whose row lacks the organic position', () => {
    const row = withoutField(buildRankedKeyword(), 'organic_position');

    expect(isDomainKeywordsResponse({
      ...buildDomainKeywords(),
      items: [row],
    })).toBe(false);
  });

  it('accepts a row of unknown metrics', () => {
    expect(isRankedKeywordRow(buildRankedKeyword({
      position: null,
      etv: null,
      url: null,
      relative_url: null,
    }))).toBe(true);
  });

  it.each(['informational', 'commercial', 'transactional', 'navigational', 'unknown'] as const)(
    'accepts a row of %s intent',
    (intent) => {
      expect(isRankedKeywordRow(buildRankedKeyword({ intent }))).toBe(true);
    },
  );

  it('refuses a row without an intent (cached before intents were sent)', () => {
    expect(isRankedKeywordRow(withoutField(buildRankedKeyword(), 'intent'))).toBe(false);
  });

  it('refuses a row of an intent outside the five app intents', () => {
    expect(isRankedKeywordRow(buildRankedKeyword({ intent: 'local' as never }))).toBe(false);
  });

  it('accepts the start of a snapshot', () => {
    expect(isTakeSnapshotResponse(SNAPSHOT_STARTED)).toBe(true);
  });

  it('accepts a keywords export chunk with its offset and limit', () => {
    expect(isDomainKeywordsResponse(buildDomainKeywords({
      offset: 2000,
      limit: 1000,
    }))).toBe(true);
  });

  it.each([
    ['without the export pricing', withoutField(buildDomainPages(), 'export')],
    ['whose request price is text', buildDomainPages({
      export: {
        ...LABS_EXPORT,
        request_usd: '0.012' as never,
      },
    })],
    ['without its offset', withoutField(buildDomainPages(), 'offset')],
  ])('refuses a pages answer %s', (_name, payload) => {
    expect(isDomainPagesResponse(payload)).toBe(false);
  });
});

describe('isSeoRecommendation', () => {
  it('accepts the stored notes of a tracked recommendation', () => {
    expect(isSeoRecommendation(buildSeoRecommendation({
      status: 'done',
      notes: 'shipped',
    }))).toBe(true);
  });

  it('refuses an unknown recommendation type', () => {
    expect(isSeoRecommendation(buildSeoRecommendation({ type: 'visibility_gap' as never }))).toBe(false);
  });

  it('refuses an unknown status', () => {
    expect(isSeoRecommendation(buildSeoRecommendation({ status: 'archived' as never }))).toBe(false);
  });
});
