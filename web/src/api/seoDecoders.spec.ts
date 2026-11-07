import {
  describe, expect, it
} from 'vitest';
import {
  InvalidSeoResponseError,
  decodeSeo,
  isKeywordResearchResponse,
  isKeywordRow,
  isSeoAccount,
  isSeoGeoResponse,
  isSerpResponse,
} from './seoDecoders';
import {
  buildKeywordRow, buildResearchResponse, buildSeoGeoResponse, buildSeoGeoRow, buildSerpResponse, withoutField
} from './seo-fixtures';

describe('isKeywordResearchResponse', () => {
  it('accepts a research response with every documented field', () => {
    expect(isKeywordResearchResponse(buildResearchResponse())).toBe(true);
  });

  it('rejects a research response without fetched_at', () => {
    const withoutFetchTime = withoutField(buildResearchResponse(), 'fetched_at');

    expect(isKeywordResearchResponse(withoutFetchTime)).toBe(false);
  });

  it('rejects a research response whose cached flag is a string', () => {
    expect(isKeywordResearchResponse({
      ...buildResearchResponse(),
      cached: 'true',
    })).toBe(false);
  });

  it('rejects a research response with an unknown data source', () => {
    expect(isKeywordResearchResponse({
      ...buildResearchResponse(),
      data_source: 'bing',
    })).toBe(false);
  });
});

describe('isKeywordRow', () => {
  it('accepts a row whose metrics are all null', () => {
    expect(isKeywordRow(buildKeywordRow({
      search_volume: null,
      keyword_difficulty: null,
      cpc: null,
      competition: null,
    }))).toBe(true);
  });

  it('rejects a row whose volume is a numeric string', () => {
    expect(isKeywordRow({
      ...buildKeywordRow(),
      search_volume: '1900',
    })).toBe(false);
  });

  it('rejects a row with an intent outside the five canonical ones', () => {
    expect(isKeywordRow({
      ...buildKeywordRow(),
      intent: 'local',
    })).toBe(false);
  });

  it('rejects a row whose trend month has no volume', () => {
    expect(isKeywordRow({
      ...buildKeywordRow(),
      trend: [{
        year: 2026,
        month: 1,
      }],
    })).toBe(false);
  });
});

describe('isSerpResponse', () => {
  it('accepts a results page with every documented field', () => {
    expect(isSerpResponse(buildSerpResponse())).toBe(true);
  });

  it('rejects a results page whose item position is missing', () => {
    expect(isSerpResponse({
      ...buildSerpResponse(),
      items: [{
        url: 'https://www.example.com',
        domain: 'example.com',
        title: '',
        description: '',
        rank_absolute: null,
      }],
    })).toBe(false);
  });
});

describe('isSeoAccount', () => {
  it('accepts the not-configured account', () => {
    expect(isSeoAccount({
      configured: false,
      login: null,
      balance_usd: null,
    })).toBe(true);
  });

  it('rejects an account whose balance is a string', () => {
    expect(isSeoAccount({
      configured: true,
      login: 'user@example.com',
      balance_usd: '12.5',
    })).toBe(false);
  });
});

describe('isSeoGeoResponse', () => {
  it('accepts a report with null competitor positions', () => {
    expect(isSeoGeoResponse(buildSeoGeoResponse())).toBe(true);
  });

  it('rejects a report row with an unknown quadrant', () => {
    expect(isSeoGeoResponse({
      ...buildSeoGeoResponse(),
      rows: [{
        ...buildSeoGeoRow(),
        quadrant: 'neutral',
      }],
    })).toBe(false);
  });

  it('rejects a report whose summary lacks a quadrant count', () => {
    expect(isSeoGeoResponse({
      ...buildSeoGeoResponse(),
      summary: {
        both_strong: 1,
        ai_gap: 0,
        seo_gap: 0,
        both_weak: 0,
      },
    })).toBe(false);
  });
});

describe('decodeSeo', () => {
  it('throws InvalidSeoResponseError naming the payload when the guard refuses it', () => {
    expect(() => decodeSeo({}, isSerpResponse, 'search results page')).toThrow(InvalidSeoResponseError);
    expect(() => decodeSeo({}, isSerpResponse, 'search results page')).toThrow('SEO API returned an invalid search results page');
  });
});
