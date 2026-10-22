import {
  describe, expect, it
} from 'vitest';
import {
  isBrandAppearancesPage, isBrandMentionsResponse
} from './brandMentionsDecoders';
import { APPEARANCE_PAGE_1 } from './brandMentions-fixtures';
import { mockBrandMentionsResponse } from '../hooks/useBrandMentions-fixtures';

describe('isBrandMentionsResponse', () => {
  it('accepts a summary answer', () => {
    expect(isBrandMentionsResponse(mockBrandMentionsResponse)).toBe(true);
  });

  it('rejects an aggregate without a brand list', () => {
    expect(isBrandMentionsResponse({
      aggregated: {},
      available_runs: [] 
    })).toBe(false);
  });

  it('rejects an answer without available runs', () => {
    expect(isBrandMentionsResponse({ aggregated: { brands: [] } })).toBe(false);
  });
});

describe('isBrandAppearancesPage', () => {
  it('accepts a page with a next token', () => {
    expect(isBrandAppearancesPage(APPEARANCE_PAGE_1)).toBe(true);
  });

  it('accepts the last page', () => {
    expect(isBrandAppearancesPage({
      ...APPEARANCE_PAGE_1,
      next_token: null 
    })).toBe(true);
  });

  it('rejects a page whose rows do not name their brand', () => {
    expect(isBrandAppearancesPage({
      ...APPEARANCE_PAGE_1,
      appearances: [{
        keyword: 'k',
        provider: 'openai' 
      }] 
    })).toBe(false);
  });

  it('rejects a page without a total', () => {
    expect(isBrandAppearancesPage({
      appearances: [],
      next_token: null 
    })).toBe(false);
  });
});
